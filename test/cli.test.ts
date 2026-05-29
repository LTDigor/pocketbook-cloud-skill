import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const cliPath = join(repoRoot, "src", "cli.ts");

type RecordedRequest = {
  method: string;
  url: string;
  authorization?: string;
  webClient?: string;
  contentType?: string;
  body: string;
};

describe("PocketBook skill CLI", () => {
  let server: Server;
  let baseUrl: string;
  let requests: RecordedRequest[];
  let cwd: string;
  let envFilePath: string;

  beforeEach(async () => {
    requests = [];
    server = createServer((request, response) => {
      void handleRequest(request, response, requests);
    });
    await new Promise<void>((resolveListen) => {
      server.listen(0, "127.0.0.1", resolveListen);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP server to listen on a random TCP port.");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
    cwd = await mkdtemp(join(tmpdir(), "pocketbook-cli-"));
    envFilePath = join(cwd, "external.env");
    await writeFile(
      join(cwd, ".env"),
      [
        "POCKETBOOK_BASE_URL=http://should-be-overridden.invalid",
        "POCKETBOOK_ACCESS_TOKEN=local-access",
        `POCKETBOOK_ENV_FILE=${envFilePath}`,
        "",
      ].join("\n"),
    );
    await writeFile(
      envFilePath,
      [
        `POCKETBOOK_BASE_URL=${baseUrl}`,
        "POCKETBOOK_ACCESS_TOKEN=external-access",
        "POCKETBOOK_REFRESH_TOKEN=external-refresh",
        "POCKETBOOK_WEB_CLIENT_ID=web-client-123",
        `POCKETBOOK_ENV_FILE=${envFilePath}`,
        "",
      ].join("\n"),
    );
  });

  afterEach(async () => {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
    await rm(cwd, { recursive: true, force: true });
  });

  it("loads POCKETBOOK_ENV_FILE, prints config JSON, and does not expose token values", async () => {
    const result = await runCli(["config"]);

    expect(result).toMatchObject({
      baseUrl,
      hasAccessToken: true,
      hasRefreshToken: true,
      hasWebClientId: true,
      hasEnvFilePath: true,
    });
    expect(JSON.stringify(result)).not.toContain("external-access");
    expect(JSON.stringify(result)).not.toContain("external-refresh");
  });

  it("runs status and generic GET commands with PocketBook auth headers", async () => {
    await expect(runCli(["status"])).resolves.toMatchObject({
      status: 200,
      bodyPreview: { ok: true, root: true },
    });
    await expect(runCli(["get", "--path=/api/custom?query=a=b"])).resolves.toMatchObject({
      status: 200,
      bodyPreview: { custom: true, query: "a=b" },
    });

    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          url: "/",
          authorization: "Bearer external-access",
          webClient: "web-client-123",
        }),
        expect.objectContaining({
          method: "GET",
          url: "/api/custom?query=a=b",
          authorization: "Bearer external-access",
          webClient: "web-client-123",
        }),
      ]),
    );
  });

  it("normalizes user, books, and books-info command output", async () => {
    await expect(runCli(["user"])).resolves.toMatchObject({
      ok: true,
      status: 200,
      user: {
        id: 4070456,
        email: "reader@example.test",
        language: "ru",
      },
    });
    await expect(runCli(["list-books", "--offset", "5", "--limit", "2"])).resolves.toMatchObject({
      ok: true,
      status: 200,
      library: {
        total: 2,
        offset: 5,
        limit: 2,
        count: 2,
        books: [
          { id: 10, title: "Aleph", author: "Jorge Luis Borges" },
          { id: "hash-2", title: "Second", author: "Ada" },
        ],
      },
    });
    await expect(runCli(["books-info"])).resolves.toMatchObject({
      ok: true,
      status: 200,
      stats: {
        books_count: 2,
      },
    });
  });

  it("uploads one file and a JSON batch through the documented commands", async () => {
    const firstPath = join(cwd, "first.epub");
    const secondPath = join(cwd, "second.pdf");
    await writeFile(firstPath, "first-book");
    await writeFile(secondPath, "second-book");

    await expect(
      runCli(["upload-file", "--file", firstPath, "--remote-name", "Remote First.epub"]),
    ).resolves.toMatchObject({
      ok: true,
      status: 200,
      upload: {
        uploaded: true,
        path: "/api/v1.1/files/Remote%20First.epub",
        remoteName: "Remote First.epub",
      },
    });
    await expect(
      runCli([
        "upload-files",
        "--files",
        JSON.stringify([
          { filePath: firstPath, remoteName: "batch-one.epub" },
          { filePath: secondPath, remoteName: "batch-two.pdf", contentType: "application/pdf" },
        ]),
      ]),
    ).resolves.toMatchObject({
      ok: true,
      total: 2,
      uploaded: 2,
      failed: 0,
      results: [
        { filePath: firstPath, remoteName: "batch-one.epub", ok: true, status: 200 },
        { filePath: secondPath, remoteName: "batch-two.pdf", ok: true, status: 200 },
      ],
    });

    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "PUT",
          url: "/api/v1.1/files/Remote%20First.epub",
          contentType: "application/epub+zip",
          body: "first-book",
        }),
        expect.objectContaining({
          method: "PUT",
          url: "/api/v1.1/files/batch-two.pdf",
          contentType: "application/pdf",
          body: "second-book",
        }),
      ]),
    );
  });

  it("refreshes tokens and persists them to POCKETBOOK_ENV_FILE", async () => {
    await expect(runCli(["refresh-token"])).resolves.toMatchObject({
      ok: true,
      status: 200,
      persisted: true,
      envFilePath,
      tokens: {
        hasAccessToken: true,
        hasRefreshToken: true,
        accessTokenLength: "new-access-token".length,
        refreshTokenLength: "new-refresh-token".length,
        expiresIn: 7200,
        tokenType: "Bearer",
      },
    });

    await expect(readFile(envFilePath, "utf8")).resolves.toContain("POCKETBOOK_ACCESS_TOKEN=new-access-token");
    await expect(readFile(envFilePath, "utf8")).resolves.toContain("POCKETBOOK_REFRESH_TOKEN=new-refresh-token");
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          url: "/api/v1.0/auth/renew-token",
          body: "grant_type=refresh_token&refresh_token=external-refresh",
        }),
      ]),
    );
  });

  it("refreshes and retries an authenticated command once after Unknown token", async () => {
    await expect(runCli(["get", "--path", "/api/requires-refresh"])).resolves.toMatchObject({
      status: 200,
      bodyPreview: {
        refreshed: true,
      },
    });

    expect(requests.map((request) => `${request.method} ${request.url} ${request.authorization}`)).toEqual([
      "GET /api/requires-refresh Bearer external-access",
      "POST /api/v1.0/auth/renew-token Bearer external-access",
      "GET /api/requires-refresh Bearer new-access-token",
    ]);
  });

  it("runs all probe commands against likely endpoint lists", async () => {
    const profile = await runCli(["probe-profile"]);
    const books = await runCli(["probe-books"]);
    const devices = await runCli(["probe-devices"]);

    expect(profile).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/api/v1.0/user", ok: true, status: 200 }),
        expect.objectContaining({ path: "/browser/api/profile", ok: true, status: 200 }),
      ]),
    );
    expect(books).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/api/v1.0/books", ok: true, status: 200 }),
        expect.objectContaining({ path: "/api/library", ok: true, status: 200 }),
      ]),
    );
    expect(devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/api/v1.0/devices", ok: true, status: 200 }),
        expect.objectContaining({ path: "/api/user/devices", ok: true, status: 200 }),
      ]),
    );
  });

  it("fails cleanly for invalid commands and invalid list-books limits", async () => {
    await expect(runCliRaw(["missing-command"])).resolves.toMatchObject({
      code: 2,
      stdout: "",
      stderr: expect.stringContaining("Unknown command: missing-command"),
    });
    await expect(runCliRaw(["list-books", "--limit", "0"])).resolves.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("--limit must be an integer between 1 and 500"),
    });
  });

  async function runCli(args: string[]): Promise<unknown> {
    const result = await runCliRaw(args);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    return JSON.parse(result.stdout) as unknown;
  }

  async function runCliRaw(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    try {
      const result = await execFileAsync(tsxBin, [cliPath, ...args], {
        cwd,
        env: {
          HOME: process.env.HOME ?? cwd,
          PATH: process.env.PATH ?? "",
          TMPDIR: process.env.TMPDIR ?? tmpdir(),
        },
        timeout: 10_000,
      });
      return {
        code: 0,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      };
    } catch (error) {
      const execError = error as { code?: number; stdout?: string; stderr?: string };
      return {
        code: execError.code ?? 1,
        stdout: execError.stdout?.trim() ?? "",
        stderr: execError.stderr?.trim() ?? "",
      };
    }
  }
});

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: RecordedRequest[],
): Promise<void> {
  const body = await readRequestBody(request);
  const recorded = {
    method: request.method ?? "GET",
    url: request.url ?? "/",
    authorization: request.headers.authorization,
    webClient: headerValue(request.headers["x-web-client"]),
    contentType: headerValue(request.headers["content-type"]),
    body,
  };
  requests.push(recorded);

  const url = new URL(recorded.url, "http://127.0.0.1");

  if (url.pathname === "/api/v1.0/auth/renew-token") {
    writeJson(response, {
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      token_type: "Bearer",
      expires_in: 7200,
    });
    return;
  }

  if (url.pathname === "/api/requires-refresh" && recorded.authorization !== "Bearer new-access-token") {
    writeJson(
      response,
      {
        error_code: 223,
        error_msg: "Unknown token",
      },
      403,
    );
    return;
  }

  if (url.pathname === "/api/requires-refresh") {
    writeJson(response, { refreshed: true });
    return;
  }

  if (recorded.method === "PUT" && url.pathname.startsWith("/api/v1.1/files/")) {
    writeJson(response, {
      uploaded: true,
      path: url.pathname,
      bytes: body.length,
    });
    return;
  }

  if (url.pathname === "/") {
    writeJson(response, { ok: true, root: true });
    return;
  }

  if (url.pathname === "/api/custom") {
    writeJson(response, { custom: true, query: url.searchParams.get("query") });
    return;
  }

  if (url.pathname === "/api/v1.0/user") {
    writeJson(response, {
      user_id: 4070456,
      email: "reader@example.test",
      language: "ru",
    });
    return;
  }

  if (url.pathname === "/api/v1.0/books") {
    writeJson(response, {
      total: 2,
      books: [
        { book_id: 10, title: "Aleph", authors: ["Jorge Luis Borges"] },
        { fast_hash: "hash-2", name: "Second", author: "Ada" },
      ],
    });
    return;
  }

  if (url.pathname === "/api/v1.0/stats/books-info") {
    writeJson(response, { books_count: 2 });
    return;
  }

  writeJson(response, { probe: true, path: url.pathname });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(", ") : value;
}
