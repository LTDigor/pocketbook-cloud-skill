import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPocketBookActions } from "../src/actions.js";

const fetchMock = vi.fn<typeof fetch>();

describe("createPocketBookActions", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("summarizes config without exposing secrets", () => {
    const actions = createPocketBookActions({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
      refreshToken: "refresh",
      webClientId: "client",
      cookieHeader: "cookie=value",
    });

    expect(actions.config()).toMatchObject({
      baseUrl: "https://cloud.pocketbook.digital",
      hasAccessToken: true,
      hasRefreshToken: true,
      hasWebClientId: true,
      hasCookie: true,
    });
  });

  it("normalizes the list books response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        total: 1,
        books: [{ book_id: 10, title: "Aleph", authors: ["Jorge Luis Borges"] }],
      }),
    );
    const actions = createPocketBookActions({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
    });

    await expect(actions.listBooks({ offset: 0, limit: 100 })).resolves.toMatchObject({
      ok: true,
      status: 200,
      library: {
        total: 1,
        count: 1,
        books: [{ id: 10, title: "Aleph", author: "Jorge Luis Borges" }],
      },
    });
  });

  it("normalizes the user response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        user_id: 4070456,
        email: "reader@example.test",
        language: "ru",
      }),
    );
    const actions = createPocketBookActions({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
    });

    await expect(actions.user()).resolves.toMatchObject({
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
    const actions = createPocketBookActions({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
    });
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-action-batch-"));
    const firstPath = join(dir, "one.epub");
    const secondPath = join(dir, "two.epub");
    await writeFile(firstPath, "one");
    await writeFile(secondPath, "two");

    const payload = await actions.uploadFiles([
      { filePath: firstPath, remoteName: "one.epub" },
      { filePath: secondPath, remoteName: "two.epub" },
    ]);

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
    const actions = createPocketBookActions({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "old-access",
      refreshToken: "old-refresh",
    });
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-action-batch-refresh-"));
    const firstPath = join(dir, "one.epub");
    const secondPath = join(dir, "two.epub");
    await writeFile(firstPath, "one");
    await writeFile(secondPath, "two");

    const payload = await actions.uploadFiles([
      { filePath: firstPath, remoteName: "one.epub" },
      { filePath: secondPath, remoteName: "two.epub" },
    ]);

    expect(payload).toMatchObject({
      ok: true,
      total: 2,
      uploaded: 2,
      failed: 0,
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
      4,
      new URL("https://cloud.pocketbook.digital/api/v1.1/files/two.epub"),
      expect.objectContaining({
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
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-action-refresh-"));
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
    const actions = createPocketBookActions({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      envFilePath,
    });

    await expect(actions.refreshToken()).resolves.toMatchObject({
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
    await expect(import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8"))).resolves.toContain(
      "POCKETBOOK_ACCESS_TOKEN=new-access",
    );
    await expect(import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8"))).resolves.toContain(
      "POCKETBOOK_REFRESH_TOKEN=new-refresh",
    );

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
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-action-refresh-no-persist-"));
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
    const actions = createPocketBookActions({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      envFilePath,
    });

    await expect(actions.refreshToken({ persist: false })).resolves.toMatchObject({
      ok: true,
      status: 200,
      persisted: false,
      envFilePath: null,
    });

    await actions.user();
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

  it("refreshes and retries once when an authenticated action sees an unknown token", async () => {
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
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-action-auto-refresh-"));
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
    const actions = createPocketBookActions({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      envFilePath,
    });

    await expect(actions.user()).resolves.toMatchObject({
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
    await expect(import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8"))).resolves.toContain(
      "POCKETBOOK_ACCESS_TOKEN=new-access",
    );

    await rm(dir, { recursive: true, force: true });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
