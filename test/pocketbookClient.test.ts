import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PocketBookClient } from "../src/pocketbookClient.js";

const fetchMock = vi.fn<typeof fetch>();

describe("PocketBookClient", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("summarizes config without exposing secrets", () => {
    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "secret-token",
      webClientId: "client-id",
      cookieHeader: "session=secret",
    });

    expect(client.getConfigSummary()).toEqual({
      baseUrl: "https://cloud.pocketbook.digital",
      hasAccessToken: true,
      hasRefreshToken: false,
      hasUsername: false,
      hasPassword: false,
      hasWebClientId: true,
      hasWebClientSecret: false,
      hasCookie: true,
      hasEnvFilePath: false,
      configuredPaths: {
        profilePath: null,
        booksPath: null,
        devicesPath: null,
      },
    });
  });

  it("renews access tokens with the configured refresh token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        access_token: "new-access",
        refresh_token: "new-refresh",
        token_type: "Bearer",
        expires_in: 7200,
      }),
    );

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      webClientId: "1779259365474",
    });

    await expect(client.renewToken()).resolves.toMatchObject({
      status: 200,
      tokens: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        tokenType: "Bearer",
        expiresIn: 7200,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://cloud.pocketbook.digital/api/v1.0/auth/renew-token"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer old-access",
          "x-web-client": "1779259365474",
          "content-type": "application/x-www-form-urlencoded",
        }),
        body: "grant_type=refresh_token&refresh_token=old-refresh",
      }),
    );
  });

  it("requires a refresh token before renewing access", async () => {
    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
    });

    await expect(client.renewToken()).rejects.toThrow("POCKETBOOK_REFRESH_TOKEN is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("discovers auth providers and logs in with username and password", async () => {
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

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
      webClientId: "client-id",
      webClientSecret: "client-secret",
    });
    const providers = await client.authProviders("reader@example.test", "ru");

    expect(providers).toMatchObject([{ alias: "pbook", shopId: "1", name: "PocketBook" }]);
    await expect(
      client.login({
        username: "reader@example.test",
        password: "secret-password",
        provider: providers[0],
        language: "ru",
      }),
    ).resolves.toMatchObject({
      status: 200,
      tokens: {
        accessToken: "login-access",
        refreshToken: "login-refresh",
        tokenType: "Bearer",
        expiresIn: 7200,
      },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL(
        "https://cloud.pocketbook.digital/api/v1.0/auth/login?username=reader%40example.test&client_id=client-id&client_secret=client-secret&language=ru",
      ),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("https://cloud.pocketbook.digital/api/v1.0/auth/login/pbook"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/x-www-form-urlencoded",
        }),
        body: "shop_id=1&username=reader%40example.test&password=secret-password&client_id=client-id&grant_type=password&client_secret=client-secret&language=ru",
      }),
    );
  });

  it("uses the public web client secret fallback for login requests when not configured", async () => {
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
        }),
      );

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
    });
    const providers = await client.authProviders("reader@example.test");
    await client.login({
      username: "reader@example.test",
      password: "secret-password",
      provider: providers[0],
    });

    expect(String(fetchMock.mock.calls[0]![0])).toContain("client_secret=");
    expect(fetchMock.mock.calls[1]![1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("client_secret="),
      }),
    );
  });

  it("sends PocketBook auth headers on GET requests", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
      webClientId: "1779259365474",
      cookieHeader: "cookie=value",
    });

    await client.user();

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://cloud.pocketbook.digital/api/v1.0/user"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer token",
          "x-web-client": "1779259365474",
          cookie: "cookie=value",
          accept: "application/json, text/plain, */*",
        }),
      }),
    );
  });

  it("builds the books URL with offset and limit", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
    });

    await client.books(50, 25);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://cloud.pocketbook.digital/api/v1.0/books?offset=50&limit=25"),
      expect.any(Object),
    );
  });

  it("refuses to send configured credentials to external absolute URLs", async () => {
    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
      cookieHeader: "session=secret",
    });

    await expect(client.get("https://example.test/api/v1.0/user")).rejects.toThrow(
      "Refusing to send PocketBook credentials to a different origin: https://example.test",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns parsed JSON previews", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user_id: 4070456 }));

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
    });

    await expect(client.user()).resolves.toMatchObject({
      status: 200,
      contentType: "application/json",
      bodyPreview: { user_id: 4070456 },
    });
  });

  it("returns text previews for non-JSON responses", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>ok</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
    });

    await expect(client.get("/")).resolves.toMatchObject({
      bodyPreview: "<html>ok</html>",
      contentType: "text/html",
    });
  });

  it("does not expose set-cookie response headers", async () => {
    fetchMock.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "session=secret",
          "x-request-id": "request-id",
        },
      }),
    );

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
    });

    const response = await client.get("/api/v1.0/user");

    expect(response).toMatchObject({
      headers: {
        "content-type": "application/json",
        "x-request-id": "request-id",
      },
    });
    expect(response.headers).not.toHaveProperty("set-cookie");
  });

  it("probes multiple paths and captures request failures", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockRejectedValueOnce(new Error("network down"));

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
    });

    await expect(client.probe(["/ok", "/fail"])).resolves.toMatchObject([
      { path: "/ok", ok: true, status: 200 },
      { path: "/fail", ok: false, status: 0, statusText: "network down" },
    ]);
  });

  it("records rejected external probe URLs without leaking credentials", async () => {
    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
      cookieHeader: "session=secret",
    });

    await expect(client.probe(["https://example.test/api/v1.0/user"])).resolves.toMatchObject([
      {
        path: "https://example.test/api/v1.0/user",
        ok: false,
        url: "https://example.test/api/v1.0/user",
        status: 0,
        statusText: "Refusing to send PocketBook credentials to a different origin: https://example.test",
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads files with PUT /api/v1.1/files/{name}", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ uploaded: true }));
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-upload-"));
    const filePath = join(dir, "book.fb2.zip");
    await writeFile(filePath, "book-data");

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
    });

    await client.uploadFile(filePath);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://cloud.pocketbook.digital/api/v1.1/files/book.fb2.zip"),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          authorization: "Bearer token",
          "content-type": "application/x-fictionbook+xml",
        }),
        body: expect.any(Blob),
      }),
    );

    await rm(dir, { recursive: true, force: true });
  });

  it("deletes books by fast_hash", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: true }));

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
      accessToken: "token",
    });

    await expect(client.deleteBook("hash with spaces")).resolves.toMatchObject({
      status: 200,
      bodyPreview: { deleted: true },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://cloud.pocketbook.digital/api/v1.1/fileops/delete/?fast_hash=hash+with+spaces"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer token",
        }),
      }),
    );
  });

  it("URL-encodes custom remote upload names", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ uploaded: true }));
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-upload-"));
    const filePath = join(dir, "book.epub");
    await writeFile(filePath, "book-data");

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
    });

    await client.uploadFile(filePath, "Борхес Алеф.fb2.zip");

    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://cloud.pocketbook.digital/api/v1.1/files/%D0%91%D0%BE%D1%80%D1%85%D0%B5%D1%81%20%D0%90%D0%BB%D0%B5%D1%84.fb2.zip",
    );

    await rm(dir, { recursive: true, force: true });
  });

  it("uploads multiple files and records per-file success", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ first: true }))
      .mockResolvedValueOnce(jsonResponse({ second: true }));
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-batch-upload-"));
    const firstPath = join(dir, "first.epub");
    const secondPath = join(dir, "second.pdf");
    await writeFile(firstPath, "first");
    await writeFile(secondPath, "second");

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
    });

    await expect(
      client.uploadFiles([
        { filePath: firstPath },
        { filePath: secondPath, remoteName: "remote-second.pdf" },
      ]),
    ).resolves.toMatchObject([
      { filePath: firstPath, ok: true, response: { status: 200 } },
      {
        filePath: secondPath,
        remoteName: "remote-second.pdf",
        ok: true,
        response: { status: 200 },
      },
    ]);

    await rm(dir, { recursive: true, force: true });
  });

  it("continues batch uploads after a per-file failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ uploaded: true }));
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-batch-upload-"));
    const firstPath = join(dir, "first.epub");
    const missingPath = join(dir, "missing.epub");
    await writeFile(firstPath, "first");

    const client = new PocketBookClient({
      baseUrl: "https://cloud.pocketbook.digital",
    });

    await expect(
      client.uploadFiles([{ filePath: missingPath }, { filePath: firstPath }]),
    ).resolves.toMatchObject([
      { filePath: missingPath, ok: false, error: expect.any(String) },
      { filePath: firstPath, ok: true, response: { status: 200 } },
    ]);

    await rm(dir, { recursive: true, force: true });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
