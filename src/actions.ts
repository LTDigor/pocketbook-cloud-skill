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

export function createPocketBookActions(config: PocketBookConfig) {
  const client = new PocketBookClient(config);

  const persistTokens = async (tokens: { accessToken?: string; refreshToken?: string }): Promise<string> => {
    const envFilePath = resolve(config.envFilePath ?? ".env");
    await updateEnvFile(envFilePath, {
      POCKETBOOK_ACCESS_TOKEN: tokens.accessToken,
      POCKETBOOK_REFRESH_TOKEN: tokens.refreshToken,
    });
    return envFilePath;
  };

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
    await persistTokens(response.tokens);

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
        await persistTokens(response.tokens);
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
    login: async (
      input: {
        username?: string;
        password?: string;
        providerAlias?: string;
        shopId?: string;
        language?: string;
        persist?: boolean;
      } = {},
    ) => {
      const username = input.username ?? config.username;
      const password = input.password ?? config.password;
      const providerAlias = input.providerAlias ?? config.providerAlias;
      const shopId = input.shopId ?? config.shopId;
      const language = input.language ?? config.language;
      const envFilePath = resolve(config.envFilePath ?? ".env");

      if (!username?.trim()) {
        throw new Error("POCKETBOOK_LOGIN or POCKETBOOK_USERNAME is required to log in.");
      }
      if (!password) {
        throw new Error("POCKETBOOK_PASSWORD is required to log in.");
      }

      const providers = await client.authProviders(username, language);
      const provider = selectAuthProvider(providers, { providerAlias, shopId });
      const response = await client.login({
        username,
        password,
        provider,
        language,
      });
      const hasNewAccessToken = Boolean(response.tokens.accessToken);
      const hasNewRefreshToken = Boolean(response.tokens.refreshToken);
      const shouldPersist = (input.persist ?? true) && isOk(response.status) && hasNewAccessToken;

      if (isOk(response.status) && hasNewAccessToken) {
        client.updateTokens(response.tokens);
      }

      if (shouldPersist) {
        await persistTokens(response.tokens);
      }

      return {
        ok: isOk(response.status),
        status: response.status,
        statusText: response.statusText,
        persisted: shouldPersist,
        envFilePath: shouldPersist ? envFilePath : null,
        provider: {
          alias: provider.alias ?? null,
          shopId: provider.shopId ?? null,
          name: provider.name ?? null,
        },
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

function selectAuthProvider(
  providers: Array<{ alias?: string; shopId?: string; name?: string; raw: Record<string, unknown> }>,
  selector: { providerAlias?: string; shopId?: string },
) {
  if (providers.length === 0) {
    throw new Error("PocketBook did not return any auth providers for this login.");
  }

  const alias = selector.providerAlias?.trim();
  const shopId = selector.shopId?.trim();
  const selected = providers.find((provider) => {
    const aliasMatches = !alias || provider.alias === alias;
    const shopMatches = !shopId || provider.shopId === shopId;
    return aliasMatches && shopMatches;
  });

  if (!selected) {
    const available = providers
      .map((provider) => [provider.alias, provider.shopId, provider.name].filter(Boolean).join("/"))
      .join(", ");
    throw new Error(`No PocketBook auth provider matched the configured selector. Available providers: ${available}`);
  }

  return selected;
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
