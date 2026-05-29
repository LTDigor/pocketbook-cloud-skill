import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { PocketBookConfig } from "./config.js";

export type HttpMethod = "GET" | "POST" | "PUT";

export type PocketBookResponse = {
  url: string;
  status: number;
  statusText: string;
  contentType: string;
  bodyPreview: unknown;
  headers: Record<string, string>;
};

export type ProbeResult = PocketBookResponse & {
  path: string;
  ok: boolean;
};

export type UploadFileInput = {
  filePath: string;
  remoteName?: string;
  contentType?: string;
};

export type BatchUploadResult = {
  filePath: string;
  remoteName?: string;
  ok: boolean;
  response?: PocketBookResponse;
  error?: string;
};

export type TokenRefreshResult = PocketBookResponse & {
  tokens: {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    tokenType?: string;
  };
};

const JSON_PREVIEW_LIMIT = 60_000;
const TEXT_PREVIEW_LIMIT = 12_000;

export class PocketBookClient {
  constructor(private readonly config: PocketBookConfig) {}

  updateTokens(tokens: { accessToken?: string; refreshToken?: string }): void {
    if (tokens.accessToken) {
      this.config.accessToken = tokens.accessToken;
    }

    if (tokens.refreshToken) {
      this.config.refreshToken = tokens.refreshToken;
    }
  }

  getConfigSummary() {
    return {
      baseUrl: this.config.baseUrl,
      hasAccessToken: Boolean(this.config.accessToken),
      hasRefreshToken: Boolean(this.config.refreshToken),
      hasWebClientId: Boolean(this.config.webClientId),
      hasCookie: Boolean(this.config.cookieHeader),
      hasEnvFilePath: Boolean(this.config.envFilePath),
      configuredPaths: {
        profilePath: this.config.profilePath ?? null,
        booksPath: this.config.booksPath ?? null,
        devicesPath: this.config.devicesPath ?? null,
      },
    };
  }

  async get(path: string): Promise<PocketBookResponse> {
    return this.request("GET", path);
  }

  async postJson(path: string, body: unknown): Promise<PocketBookResponse> {
    return this.request("POST", path, body);
  }

  async renewToken(refreshToken = this.config.refreshToken): Promise<TokenRefreshResult> {
    if (!refreshToken?.trim()) {
      throw new Error("POCKETBOOK_REFRESH_TOKEN is required to renew PocketBook Cloud auth.");
    }

    const response = await this.request(
      "POST",
      "/api/v1.0/auth/renew-token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken.trim(),
      }),
      { contentType: "application/x-www-form-urlencoded" },
    );

    const body = response.bodyPreview;
    const tokenBody = isRecord(body) ? body : {};

    return {
      ...response,
      tokens: {
        accessToken: stringValue(tokenBody.access_token),
        refreshToken: stringValue(tokenBody.refresh_token),
        expiresIn: numberValue(tokenBody.expires_in),
        tokenType: stringValue(tokenBody.token_type),
      },
    };
  }

  async user(): Promise<PocketBookResponse> {
    return this.get("/api/v1.0/user");
  }

  async books(offset: number, limit: number): Promise<PocketBookResponse> {
    return this.get(`/api/v1.0/books?offset=${offset}&limit=${limit}`);
  }

  async booksInfo(): Promise<PocketBookResponse> {
    return this.get("/api/v1.0/stats/books-info");
  }

  async uploadFile(filePath: string, remoteName?: string, contentType?: string): Promise<PocketBookResponse> {
    const bytes = await readFile(filePath);
    const safeName = encodeURIComponent(remoteName?.trim() || basename(filePath));
    return this.request("PUT", `/api/v1.1/files/${safeName}`, bytes, {
      contentType: contentType || guessContentType(filePath),
    });
  }

  async uploadFiles(files: UploadFileInput[]): Promise<BatchUploadResult[]> {
    const results: BatchUploadResult[] = [];

    for (const file of files) {
      try {
        const response = await this.uploadFile(file.filePath, file.remoteName, file.contentType);
        results.push({
          filePath: file.filePath,
          remoteName: file.remoteName,
          ok: response.status >= 200 && response.status < 300,
          response,
        });
      } catch (error) {
        results.push({
          filePath: file.filePath,
          remoteName: file.remoteName,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  async probe(paths: string[]): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];

    for (const path of paths) {
      try {
        const response = await this.get(path);
        results.push({
          ...response,
          path,
          ok: response.status >= 200 && response.status < 300,
        });
      } catch (error) {
        results.push({
          path,
          ok: false,
          url: this.tryFormatUrl(path),
          status: 0,
          statusText: error instanceof Error ? error.message : String(error),
          contentType: "",
          headers: {},
          bodyPreview: null,
        });
      }
    }

    return results;
  }

  private async request(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options: { contentType?: string } = {},
  ): Promise<PocketBookResponse> {
    const headers: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      "user-agent": "pocketbook-cloud-skill/0.1",
      "cache-control": "no-cache",
    };

    if (this.config.accessToken) {
      headers.authorization = `Bearer ${this.config.accessToken}`;
    }

    if (this.config.webClientId) {
      headers["x-web-client"] = this.config.webClientId;
    }

    if (this.config.cookieHeader) {
      headers.cookie = this.config.cookieHeader;
    }

    if (body !== undefined && !(body instanceof Uint8Array)) {
      headers["content-type"] = options.contentType ?? "application/json";
    } else if (options.contentType) {
      headers["content-type"] = options.contentType;
    }

    const response = await fetch(this.toUrl(path), {
      method,
      headers,
      body: serializeBody(body),
      redirect: "follow",
    });

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();

    return {
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      contentType,
      headers: pickHeaders(response.headers),
      bodyPreview: parsePreview(text, contentType),
    };
  }

  private toUrl(path: string): URL {
    if (/^https?:\/\//i.test(path)) {
      const url = new URL(path);
      const baseUrl = new URL(this.config.baseUrl);
      if (url.origin !== baseUrl.origin) {
        throw new Error(`Refusing to send PocketBook credentials to a different origin: ${url.origin}`);
      }
      return url;
    }

    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return new URL(`${this.config.baseUrl}${normalizedPath}`);
  }

  private tryFormatUrl(path: string): string {
    try {
      return this.toUrl(path).toString();
    } catch {
      return path;
    }
  }
}

function serializeBody(body: unknown): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (body instanceof Uint8Array) {
    const copy = new ArrayBuffer(body.byteLength);
    new Uint8Array(copy).set(body);
    return new Blob([copy]);
  }

  return JSON.stringify(body);
}

function parsePreview(text: string, contentType: string): unknown {
  if (contentType.includes("application/json")) {
    const clipped = text.slice(0, JSON_PREVIEW_LIMIT);
    try {
      return JSON.parse(clipped);
    } catch {
      return clipped;
    }
  }

  return text.slice(0, TEXT_PREVIEW_LIMIT);
}

function pickHeaders(headers: Headers): Record<string, string> {
  const useful = ["content-type", "location", "x-request-id", "x-cache"];
  const result: Record<string, string> = {};

  for (const key of useful) {
    const value = headers.get(key);
    if (value) {
      result[key] = value;
    }
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function guessContentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".fb2") || lower.endsWith(".fb2.zip")) {
    return "application/x-fictionbook+xml";
  }
  if (lower.endsWith(".epub")) {
    return "application/epub+zip";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain";
  }
  return "application/octet-stream";
}
