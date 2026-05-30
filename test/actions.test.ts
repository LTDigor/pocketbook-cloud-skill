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

  it("deletes a book by fast_hash", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: true }));
    const actions = createPocketBookActions({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
    });

    await expect(actions.deleteBook({ fastHash: "fast-hash-1" })).resolves.toMatchObject({
      ok: true,
      status: 200,
      deletion: {
        deleted: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://cloud.pocketbook.digital/api/v1.1/fileops/delete/?fast_hash=fast-hash-1"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer token",
        }),
      }),
    );
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
      'POCKETBOOK_ACCESS_TOKEN="new-access"',
    );
    await expect(import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8"))).resolves.toContain(
      'POCKETBOOK_REFRESH_TOKEN="new-refresh"',
    );

    await rm(dir, { recursive: true, force: true });
  });

  it("quotes persisted token values so dotenv parses special characters", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        access_token: "new#access with space",
        refresh_token: "new=refresh#value",
      }),
    );
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-action-refresh-quoted-"));
    const envFilePath = join(dir, ".env");
    await writeFile(
      envFilePath,
      [
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
      persisted: true,
    });
    await expect(import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8"))).resolves.toContain(
      'POCKETBOOK_ACCESS_TOKEN="new#access with space"',
    );
    await expect(import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8"))).resolves.toContain(
      'POCKETBOOK_REFRESH_TOKEN="new=refresh#value"',
    );

    await rm(dir, { recursive: true, force: true });
  });

  it("logs in with env credentials and persists returned tokens", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          providers: [{ alias: "pbook", shop_id: 1, name: "PocketBook" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "login-access",
          refresh_token: "login-refresh",
          token_type: "Bearer",
          expires_in: 7200,
        }),
      );
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-action-login-"));
    const envFilePath = join(dir, ".env");
    await writeFile(envFilePath, "POCKETBOOK_BASE_URL=https://cloud.pocketbook.digital\n");
    const actions = createPocketBookActions({
      baseUrl: "https://cloud.pocketbook.digital",
      username: "reader@example.test",
      password: "secret-password",
      envFilePath,
      webClientId: "client-id",
      webClientSecret: "client-secret",
      language: "ru",
    });

    await expect(actions.login()).resolves.toMatchObject({
      ok: true,
      status: 200,
      persisted: true,
      provider: {
        alias: "pbook",
        shopId: "1",
        name: "PocketBook",
      },
      tokens: {
        hasAccessToken: true,
        hasRefreshToken: true,
        accessTokenLength: 12,
        refreshTokenLength: 13,
        expiresIn: 7200,
      },
    });
    await expect(import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8"))).resolves.toContain(
      'POCKETBOOK_ACCESS_TOKEN="login-access"',
    );
    await expect(import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8"))).resolves.toContain(
      'POCKETBOOK_REFRESH_TOKEN="login-refresh"',
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
      'POCKETBOOK_ACCESS_TOKEN="new-access"',
    );

    await rm(dir, { recursive: true, force: true });
  });

  it("logs in and retries when refresh cannot recover a bad access token", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error_code: 222,
            error_msg: "Wrong token format",
          },
          403,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error_msg: "Invalid refresh token",
          },
          403,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          providers: [{ alias: "pbook", shop_id: 1, name: "PocketBook" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "login-access",
          refresh_token: "login-refresh",
          token_type: "Bearer",
          expires_in: 7200,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ user_id: 4070456, email: "reader@example.test" }));
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-action-login-recover-"));
    const envFilePath = join(dir, ".env");
    await writeFile(
      envFilePath,
      [
        "POCKETBOOK_BASE_URL=https://cloud.pocketbook.digital",
        "POCKETBOOK_ACCESS_TOKEN=bad-access",
        "POCKETBOOK_REFRESH_TOKEN=bad-refresh",
        "",
      ].join("\n"),
    );
    const actions = createPocketBookActions({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "bad-access",
      refreshToken: "bad-refresh",
      username: "reader@example.test",
      password: "secret-password",
      webClientId: "client-id",
      webClientSecret: "client-secret",
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
      5,
      new URL("https://cloud.pocketbook.digital/api/v1.0/user"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer login-access",
        }),
      }),
    );
    await expect(import("node:fs/promises").then(({ readFile }) => readFile(envFilePath, "utf8"))).resolves.toContain(
      'POCKETBOOK_ACCESS_TOKEN="login-access"',
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
