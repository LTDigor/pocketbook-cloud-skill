import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PocketBookConfig } from "./config.js";
import { PocketBookClient, type BatchUploadResult, type UploadFileInput } from "./pocketbookClient.js";
import {
  normalizeBooksPayload,
  normalizeStatsPayload,
  normalizeUploadPayload,
  normalizeUserPayload,
} from "./normalizers.js";

const DEFAULT_PROFILE_PATHS = [
  "/api/v1.0/user",
  "/api/v1.0/is-user-logged",
  "/api/v1.0/user-info",
  "/api/v1.1/user",
  "/api/profile",
  "/browser/api/profile",
];

const DEFAULT_BOOK_PATHS = [
  "/api/v1.0/books",
  "/api/v1.0/books/last-opened",
  "/api/v1.0/books/status/",
  "/api/v1.0/books/purchased",
  "/api/v1.0/books/recent",
  "/api/v1.0/books/favorites",
  "/api/v1.1/books",
  "/api/books",
  "/api/library",
];

const DEFAULT_DEVICE_PATHS = [
  "/api/v1.0/devices",
  "/api/v1.1/devices",
  "/api/v1.0/user/devices",
  "/api/devices",
  "/api/user/devices",
];

export type PocketBookActions = ReturnType<typeof createPocketBookActions>;

export function createPocketBookActions(config: PocketBookConfig) {
  const client = new PocketBookClient(config);

  const refreshAuth = async (): Promise<boolean> => {
    if (!config.refreshToken) {
      return false;
    }

    const response = await client.renewToken();
    const hasNewAccessToken = Boolean(response.tokens.accessToken);
    if (!isOk(response.status) || !hasNewAccessToken) {
      return false;
    }

    client.updateTokens(response.tokens);
    await updateEnvFile(resolve(config.envFilePath ?? ".env"), {
      POCKETBOOK_ACCESS_TOKEN: response.tokens.accessToken,
      POCKETBOOK_REFRESH_TOKEN: response.tokens.refreshToken,
    });

    return true;
  };

  const withAuthRefresh = async <T extends { status: number; bodyPreview: unknown }>(
    action: () => Promise<T>,
  ): Promise<T> => {
    const response = await action();
    if (!isUnknownToken(response) || !(await refreshAuth())) {
      return response;
    }

    return action();
  };

  return {
    config: () => client.getConfigSummary(),
    status: () => client.get("/"),
    refreshToken: async (input: { refreshToken?: string; persist?: boolean } = {}) => {
      const response = await client.renewToken(input.refreshToken);
      const hasNewAccessToken = Boolean(response.tokens.accessToken);
      const hasNewRefreshToken = Boolean(response.tokens.refreshToken);
      const shouldPersist = (input.persist ?? true) && isOk(response.status) && hasNewAccessToken;
      const envFilePath = resolve(config.envFilePath ?? ".env");

      if (isOk(response.status) && hasNewAccessToken) {
        client.updateTokens(response.tokens);
      }

      if (shouldPersist) {
        await updateEnvFile(envFilePath, {
          POCKETBOOK_ACCESS_TOKEN: response.tokens.accessToken,
          POCKETBOOK_REFRESH_TOKEN: response.tokens.refreshToken,
        });
      }

      return {
        ok: isOk(response.status),
        status: response.status,
        statusText: response.statusText,
        persisted: shouldPersist,
        envFilePath: shouldPersist ? envFilePath : null,
        tokens: {
          hasAccessToken: hasNewAccessToken,
          hasRefreshToken: hasNewRefreshToken,
          accessTokenLength: response.tokens.accessToken?.length ?? 0,
          refreshTokenLength: response.tokens.refreshToken?.length ?? 0,
          expiresIn: response.tokens.expiresIn ?? null,
          tokenType: response.tokens.tokenType ?? null,
        },
        error: errorMessage(response.bodyPreview),
      };
    },
    get: (path: string) => withAuthRefresh(() => client.get(path)),
    user: async () => {
      const response = await withAuthRefresh(() => client.user());
      return {
        ok: isOk(response.status),
        status: response.status,
        user: normalizeUserPayload(response.bodyPreview),
      };
    },
    listBooks: async (input: { offset?: number; limit?: number } = {}) => {
      const offset = input.offset ?? 0;
      const limit = input.limit ?? 100;
      const response = await withAuthRefresh(() => client.books(offset, limit));
      return {
        ok: isOk(response.status),
        status: response.status,
        library: normalizeBooksPayload(response.bodyPreview, offset, limit),
      };
    },
    booksInfo: async () => {
      const response = await withAuthRefresh(() => client.booksInfo());
      return {
        ok: isOk(response.status),
        status: response.status,
        stats: normalizeStatsPayload(response.bodyPreview),
      };
    },
    uploadFile: async (input: UploadFileInput) => {
      const response = await withAuthRefresh(() =>
        client.uploadFile(input.filePath, input.remoteName, input.contentType),
      );
      return {
        ok: isOk(response.status),
        status: response.status,
        upload: normalizeUploadPayload(response.bodyPreview, input.remoteName),
      };
    },
    uploadFiles: async (files: UploadFileInput[]) => {
      const initialResults = await client.uploadFiles(files);
      const hasUnknownToken = initialResults.some((result) => result.response && isUnknownToken(result.response));
      const results = hasUnknownToken && (await refreshAuth())
        ? mergeUploadResults(
            initialResults,
            await client.uploadFiles(files.filter((_, index) => !initialResults[index]?.ok)),
            initialResults
              .map((result, index) => (!result.ok ? index : -1))
              .filter((index): index is number => index >= 0),
          )
        : initialResults;

      return {
        ok: results.every((result) => result.ok),
        total: results.length,
        uploaded: results.filter((result) => result.ok).length,
        failed: results.filter((result) => !result.ok).length,
        results: results.map((result) => ({
          filePath: result.filePath,
          remoteName: result.remoteName ?? null,
          ok: result.ok,
          status: result.response?.status ?? null,
          upload: result.response ? normalizeUploadPayload(result.response.bodyPreview, result.remoteName) : null,
          error: result.error ?? null,
        })),
      };
    },
    probeProfile: () => client.probe(unique([config.profilePath, ...DEFAULT_PROFILE_PATHS])),
    probeBooks: () => client.probe(unique([config.booksPath, ...DEFAULT_BOOK_PATHS])),
    probeDevices: () => client.probe(unique([config.devicesPath, ...DEFAULT_DEVICE_PATHS])),
  };
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

function isUnknownToken(response: { status: number; bodyPreview: unknown }): boolean {
  const body = response.bodyPreview;
  return response.status === 403 && isRecord(body) && body.error_code === 223;
}

function mergeUploadResults(
  initialResults: BatchUploadResult[],
  retriedResults: BatchUploadResult[],
  failedIndexes: number[],
): BatchUploadResult[] {
  const results = [...initialResults];

  for (let retryIndex = 0; retryIndex < failedIndexes.length; retryIndex += 1) {
    const originalIndex = failedIndexes[retryIndex];
    const retriedResult = retriedResults[retryIndex];
    if (retriedResult) {
      results[originalIndex] = retriedResult;
    }
  }

  return results;
}

async function updateEnvFile(filePath: string, values: Record<string, string | undefined>): Promise<void> {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }

  for (const [key, value] of Object.entries(values)) {
    if (!value) {
      continue;
    }

    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
    text = pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\s*$/, "")}\n${line}\n`;
  }

  await writeFile(filePath, text, "utf8");
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function errorMessage(body: unknown): string | null {
  if (body && typeof body === "object" && "error_msg" in body && typeof body.error_msg === "string") {
    return body.error_msg;
  }

  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }

  return null;
}
