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
});

function toolHandler(server: McpServer, name: string) {
  const registeredTools = (
    server as unknown as {
      _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: Array<{ text: string }> }> }>;
    }
  )._registeredTools;

  return registeredTools[name]!.handler;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
