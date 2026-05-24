import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPocketBookTools } from "../src/tools.js";

const fetchMock = vi.fn<typeof fetch>();

describe("registerPocketBookTools", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers the expected PocketBook tools", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerPocketBookTools(server, {
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
    });

    const registeredTools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;

    expect(Object.keys(registeredTools)).toEqual(
      expect.arrayContaining([
        "pocketbook_config",
        "pocketbook_cloud_status",
        "pocketbook_refresh_token",
        "pocketbook_get",
        "pocketbook_user",
        "pocketbook_list_books",
        "pocketbook_books_info",
        "pocketbook_upload_file",
        "pocketbook_upload_files",
        "pocketbook_probe_profile",
        "pocketbook_probe_books",
        "pocketbook_probe_devices",
      ]),
    );
  });

  it("normalizes the list books tool response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        total: 1,
        books: [{ book_id: 10, title: "Aleph", authors: ["Jorge Luis Borges"] }],
      }),
    );
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerPocketBookTools(server, {
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
    });

    const result = await toolHandler(server, "pocketbook_list_books")({ offset: 0, limit: 100 });
    const payload = JSON.parse(result.content[0].text);

    expect(payload).toMatchObject({
      ok: true,
      status: 200,
      library: {
        total: 1,
        count: 1,
        books: [{ id: 10, title: "Aleph", author: "Jorge Luis Borges" }],
      },
    });
  });

  it("normalizes the user tool response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        user_id: 4070456,
        email: "reader@example.test",
        language: "ru",
      }),
    );
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerPocketBookTools(server, {
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
    });

    const result = await toolHandler(server, "pocketbook_user")({});
    const payload = JSON.parse(result.content[0].text);

    expect(payload).toMatchObject({
      ok: true,
      status: 200,
      user: {
        id: 4070456,
        email: "reader@example.test",
        language: "ru",
      },
    });
  });

  it("returns a batch upload report", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ uploaded: "one" }))
      .mockResolvedValueOnce(jsonResponse({ uploaded: "two" }));
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerPocketBookTools(server, {
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
    });
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-tool-batch-"));
    const firstPath = join(dir, "one.epub");
    const secondPath = join(dir, "two.epub");
    await writeFile(firstPath, "one");
    await writeFile(secondPath, "two");

    const result = await toolHandler(server, "pocketbook_upload_files")({
      files: [
        { filePath: firstPath, remoteName: "one.epub" },
        { filePath: secondPath, remoteName: "two.epub" },
      ],
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload).toMatchObject({
      ok: true,
      total: 2,
      uploaded: 2,
      failed: 0,
      results: [
        { filePath: firstPath, remoteName: "one.epub", ok: true, status: 200 },
        { filePath: secondPath, remoteName: "two.epub", ok: true, status: 200 },
      ],
    });

    await rm(dir, { recursive: true, force: true });
  });

  it("retries only failed uploads after refreshing auth", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ uploaded: "one" }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error_code: 223,
            error_msg: "Unknown token",
          },
          403,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-access",
          refresh_token: "new-refresh",
          token_type: "Bearer",
          expires_in: 7200,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ uploaded: "two" }));
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerPocketBookTools(server, {
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "old-access",
      refreshToken: "old-refresh",
    });
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-tool-batch-refresh-"));
    const firstPath = join(dir, "one.epub");
    const secondPath = join(dir, "two.epub");
    await writeFile(firstPath, "one");
    await writeFile(secondPath, "two");

    const result = await toolHandler(server, "pocketbook_upload_files")({
      files: [
        { filePath: firstPath, remoteName: "one.epub" },
        { filePath: secondPath, remoteName: "two.epub" },
      ],
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload).toMatchObject({
      ok: true,
      total: 2,
      uploaded: 2,
      failed: 0,
      results: [
        { filePath: firstPath, remoteName: "one.epub", ok: true, status: 200 },
        { filePath: secondPath, remoteName: "two.epub", ok: true, status: 200 },
      ],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("https://cloud.pocketbook.digital/api/v1.1/files/one.epub"),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          authorization: "Bearer old-access",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("https://cloud.pocketbook.digital/api/v1.1/files/two.epub"),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          authorization: "Bearer old-access",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      new URL("https://cloud.pocketbook.digital/api/v1.1/files/two.epub"),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          authorization: "Bearer new-access",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await rm(dir, { recursive: true, force: true });
  });

  it("refreshes tokens and persists them to an env file", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        access_token: "new-access",
        refresh_token: "new-refresh",
        token_type: "Bearer",
        expires_in: 7200,
      }),
    );
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-tool-refresh-"));
    const envFilePath = join(dir, ".env");
    await writeFile(
      envFilePath,
      [
        "POCKETBOOK_BASE_URL=https://cloud.pocketbook.digital",
        "POCKETBOOK_ACCESS_TOKEN=old-access",
        "POCKETBOOK_REFRESH_TOKEN=old-refresh",
        "",
      ].join("\n"),
    );
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerPocketBookTools(server, {
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      envFilePath,
    });

    const result = await toolHandler(server, "pocketbook_refresh_token")({});
    const payload = JSON.parse(result.content[0].text);

    expect(payload).toMatchObject({
      ok: true,
      status: 200,
      persisted: true,
      tokens: {
        hasAccessToken: true,
        hasRefreshToken: true,
        accessTokenLength: 10,
        refreshTokenLength: 11,
        expiresIn: 7200,
      },
    });

    await expect(
      import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8")),
    ).resolves.toContain("POCKETBOOK_ACCESS_TOKEN=new-access");
    await expect(
      import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8")),
    ).resolves.toContain("POCKETBOOK_REFRESH_TOKEN=new-refresh");

    await rm(dir, { recursive: true, force: true });
  });

  it("refreshes tokens in memory without persisting when disabled", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-access",
          refresh_token: "new-refresh",
          token_type: "Bearer",
          expires_in: 7200,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ user_id: 4070456, email: "reader@example.test" }));
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-tool-refresh-no-persist-"));
    const envFilePath = join(dir, ".env");
    await writeFile(
      envFilePath,
      [
        "POCKETBOOK_BASE_URL=https://cloud.pocketbook.digital",
        "POCKETBOOK_ACCESS_TOKEN=old-access",
        "POCKETBOOK_REFRESH_TOKEN=old-refresh",
        "",
      ].join("\n"),
    );
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerPocketBookTools(server, {
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      envFilePath,
    });

    const result = await toolHandler(server, "pocketbook_refresh_token")({ persist: false });
    const payload = JSON.parse(result.content[0].text);

    expect(payload).toMatchObject({
      ok: true,
      status: 200,
      persisted: false,
      envFilePath: null,
    });

    await toolHandler(server, "pocketbook_user")({});
    expect(fetchMock).toHaveBeenLastCalledWith(
      new URL("https://cloud.pocketbook.digital/api/v1.0/user"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer new-access",
        }),
      }),
    );
    await expect(
      import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8")),
    ).resolves.not.toContain("POCKETBOOK_ACCESS_TOKEN=new-access");

    await rm(dir, { recursive: true, force: true });
  });

  it("uses refreshed tokens for later tool calls without restarting the server", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-access",
          refresh_token: "new-refresh",
          token_type: "Bearer",
          expires_in: 7200,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ user_id: 4070456, email: "reader@example.test" }));
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-tool-refresh-runtime-"));
    const envFilePath = join(dir, ".env");
    await writeFile(
      envFilePath,
      [
        "POCKETBOOK_BASE_URL=https://cloud.pocketbook.digital",
        "POCKETBOOK_ACCESS_TOKEN=old-access",
        "POCKETBOOK_REFRESH_TOKEN=old-refresh",
        "",
      ].join("\n"),
    );
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerPocketBookTools(server, {
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      envFilePath,
    });

    await toolHandler(server, "pocketbook_refresh_token")({});
    await toolHandler(server, "pocketbook_user")({});

    expect(fetchMock).toHaveBeenLastCalledWith(
      new URL("https://cloud.pocketbook.digital/api/v1.0/user"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer new-access",
        }),
      }),
    );

    await rm(dir, { recursive: true, force: true });
  });

  it("refreshes and retries once when an authenticated tool sees an unknown token", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error_code: 223,
            error_msg: "Unknown token",
          },
          403,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-access",
          refresh_token: "new-refresh",
          token_type: "Bearer",
          expires_in: 7200,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ user_id: 4070456, email: "reader@example.test" }));
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-tool-auto-refresh-"));
    const envFilePath = join(dir, ".env");
    await writeFile(
      envFilePath,
      [
        "POCKETBOOK_BASE_URL=https://cloud.pocketbook.digital",
        "POCKETBOOK_ACCESS_TOKEN=old-access",
        "POCKETBOOK_REFRESH_TOKEN=old-refresh",
        "",
      ].join("\n"),
    );
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerPocketBookTools(server, {
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      envFilePath,
    });

    const result = await toolHandler(server, "pocketbook_user")({});
    const payload = JSON.parse(result.content[0].text);

    expect(payload).toMatchObject({
      ok: true,
      status: 200,
      user: {
        id: 4070456,
        email: "reader@example.test",
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("https://cloud.pocketbook.digital/api/v1.0/user"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer old-access",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      new URL("https://cloud.pocketbook.digital/api/v1.0/user"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer new-access",
        }),
      }),
    );
    await expect(
      import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8")),
    ).resolves.toContain("POCKETBOOK_ACCESS_TOKEN=new-access");

    await rm(dir, { recursive: true, force: true });
  });
});

function toolHandler(server: McpServer, name: string) {
  const registeredTools = (
    server as unknown as {
      _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text: string }> }> }>;
    }
  )._registeredTools;

  return registeredTools[name]!.handler;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
