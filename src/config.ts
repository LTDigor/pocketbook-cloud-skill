import { readFile } from "node:fs/promises";

export type PocketBookConfig = {
  baseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  webClientId?: string;
  cookieHeader?: string;
  envFilePath?: string;
  booksPath?: string;
  devicesPath?: string;
  profilePath?: string;
};

const DEFAULT_BASE_URL = "https://cloud.pocketbook.digital";

export async function loadConfig(): Promise<PocketBookConfig> {
  const cookieHeader =
    process.env.POCKETBOOK_COOKIE_HEADER?.trim() ||
    (await readCookieFile(process.env.POCKETBOOK_COOKIE_FILE));

  return {
    baseUrl: normalizeBaseUrl(process.env.POCKETBOOK_BASE_URL || DEFAULT_BASE_URL),
    accessToken: emptyToUndefined(process.env.POCKETBOOK_ACCESS_TOKEN),
    refreshToken: emptyToUndefined(process.env.POCKETBOOK_REFRESH_TOKEN),
    webClientId: emptyToUndefined(process.env.POCKETBOOK_WEB_CLIENT_ID),
    cookieHeader,
    envFilePath: emptyToUndefined(process.env.POCKETBOOK_ENV_FILE),
    booksPath: emptyToUndefined(process.env.POCKETBOOK_BOOKS_PATH),
    devicesPath: emptyToUndefined(process.env.POCKETBOOK_DEVICES_PATH),
    profilePath: emptyToUndefined(process.env.POCKETBOOK_PROFILE_PATH),
  };
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function readCookieFile(path: string | undefined): Promise<string | undefined> {
  if (!path?.trim()) {
    return undefined;
  }

  const raw = (await readFile(path.trim(), "utf8")).trim();
  if (!raw) {
    return undefined;
  }

  if (raw.startsWith("{")) {
    const parsed = JSON.parse(raw) as { cookie?: unknown };
    return typeof parsed.cookie === "string" && parsed.cookie.trim()
      ? parsed.cookie.trim()
      : undefined;
  }

  return raw.replace(/^cookie:\s*/i, "").trim();
}
