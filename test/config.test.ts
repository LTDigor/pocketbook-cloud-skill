import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const ENV_KEYS = [
  "POCKETBOOK_BASE_URL",
  "POCKETBOOK_ACCESS_TOKEN",
  "POCKETBOOK_REFRESH_TOKEN",
  "POCKETBOOK_LOGIN",
  "POCKETBOOK_USERNAME",
  "POCKETBOOK_PASSWORD",
  "POCKETBOOK_PROVIDER_ALIAS",
  "POCKETBOOK_SHOP_ID",
  "POCKETBOOK_LANGUAGE",
  "POCKETBOOK_WEB_CLIENT_ID",
  "POCKETBOOK_WEB_CLIENT_SECRET",
  "POCKETBOOK_ENV_FILE",
  "POCKETBOOK_COOKIE_HEADER",
  "POCKETBOOK_COOKIE_FILE",
  "POCKETBOOK_BOOKS_PATH",
  "POCKETBOOK_DEVICES_PATH",
  "POCKETBOOK_PROFILE_PATH",
];

const originalEnv = { ...process.env };

describe("loadConfig", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses PocketBook Cloud as the default base URL", async () => {
    await expect(loadConfig()).resolves.toMatchObject({
      baseUrl: "https://cloud.pocketbook.digital",
    });
  });

  it("normalizes the base URL and reads token settings", async () => {
    process.env.POCKETBOOK_BASE_URL = "https://example.test///";
    process.env.POCKETBOOK_ACCESS_TOKEN = "token";
    process.env.POCKETBOOK_REFRESH_TOKEN = "refresh-token";
    process.env.POCKETBOOK_LOGIN = "reader@example.test";
    process.env.POCKETBOOK_PASSWORD = "password";
    process.env.POCKETBOOK_PROVIDER_ALIAS = "pbook";
    process.env.POCKETBOOK_SHOP_ID = "10";
    process.env.POCKETBOOK_LANGUAGE = "ru";
    process.env.POCKETBOOK_WEB_CLIENT_ID = "client-id";
    process.env.POCKETBOOK_WEB_CLIENT_SECRET = "client-secret";
    process.env.POCKETBOOK_ENV_FILE = "/tmp/pocketbook.env";

    await expect(loadConfig()).resolves.toMatchObject({
      baseUrl: "https://example.test",
      accessToken: "token",
      refreshToken: "refresh-token",
      username: "reader@example.test",
      password: "password",
      providerAlias: "pbook",
      shopId: "10",
      language: "ru",
      webClientId: "client-id",
      webClientSecret: "client-secret",
      envFilePath: "/tmp/pocketbook.env",
    });
  });

  it("prefers an explicit cookie header over a cookie file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-config-"));
    const cookieFile = join(dir, "cookie.txt");
    await writeFile(cookieFile, "from=file");

    process.env.POCKETBOOK_COOKIE_HEADER = "from=env";
    process.env.POCKETBOOK_COOKIE_FILE = cookieFile;

    await expect(loadConfig()).resolves.toMatchObject({
      cookieHeader: "from=env",
    });

    await rm(dir, { recursive: true, force: true });
  });

  it("loads a raw cookie file and strips an optional Cookie prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-config-"));
    const cookieFile = join(dir, "cookie.txt");
    await writeFile(cookieFile, "Cookie: session=abc");

    process.env.POCKETBOOK_COOKIE_FILE = cookieFile;

    await expect(loadConfig()).resolves.toMatchObject({
      cookieHeader: "session=abc",
    });

    await rm(dir, { recursive: true, force: true });
  });

  it("loads a JSON cookie file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pocketbook-config-"));
    const cookieFile = join(dir, "cookie.json");
    await writeFile(cookieFile, JSON.stringify({ cookie: "json=cookie" }));

    process.env.POCKETBOOK_COOKIE_FILE = cookieFile;

    await expect(loadConfig()).resolves.toMatchObject({
      cookieHeader: "json=cookie",
    });

    await rm(dir, { recursive: true, force: true });
  });
});
