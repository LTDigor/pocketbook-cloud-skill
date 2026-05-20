import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PocketBookConfig } from "./config.js";
import { PocketBookClient } from "./pocketbookClient.js";
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

export function registerPocketBookTools(server: McpServer, config: PocketBookConfig): void {
  const client = new PocketBookClient(config);

  server.registerTool(
    "pocketbook_config",
    {
      title: "PocketBook config",
      description: "Show non-secret PocketBook MCP configuration.",
      inputSchema: {},
    },
    async () => asJson(client.getConfigSummary()),
  );

  server.registerTool(
    "pocketbook_cloud_status",
    {
      title: "PocketBook Cloud status",
      description: "Check whether the configured PocketBook Cloud base URL is reachable.",
      inputSchema: {},
    },
    async () => asJson(await client.get("/")),
  );

  server.registerTool(
    "pocketbook_get",
    {
      title: "PocketBook GET",
      description: "Run an authenticated GET request against PocketBook. Use this for API discovery.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Relative path such as /api/books or an absolute PocketBook URL."),
      },
    },
    async ({ path }) => asJson(await client.get(path)),
  );

  server.registerTool(
    "pocketbook_user",
    {
      title: "PocketBook user",
      description: "Get the authenticated PocketBook Cloud user profile.",
      inputSchema: {},
    },
    async () => {
      const response = await client.user();
      return asJson({
        ok: isOk(response.status),
        status: response.status,
        user: normalizeUserPayload(response.bodyPreview),
      });
    },
  );

  server.registerTool(
    "pocketbook_list_books",
    {
      title: "PocketBook books",
      description: "List books from the authenticated PocketBook Cloud library.",
      inputSchema: {
        offset: z.number().int().min(0).default(0).describe("Pagination offset."),
        limit: z.number().int().min(1).max(500).default(100).describe("Page size."),
      },
    },
    async ({ offset, limit }) => {
      const response = await client.books(offset, limit);
      return asJson({
        ok: isOk(response.status),
        status: response.status,
        library: normalizeBooksPayload(response.bodyPreview, offset, limit),
      });
    },
  );

  server.registerTool(
    "pocketbook_books_info",
    {
      title: "PocketBook books stats",
      description: "Get PocketBook Cloud book statistics.",
      inputSchema: {},
    },
    async () => {
      const response = await client.booksInfo();
      return asJson({
        ok: isOk(response.status),
        status: response.status,
        stats: normalizeStatsPayload(response.bodyPreview),
      });
    },
  );

  server.registerTool(
    "pocketbook_upload_file",
    {
      title: "Upload file to PocketBook Cloud",
      description: "Upload a local ebook file to PocketBook Cloud using PUT /api/v1.1/files/{name}.",
      inputSchema: {
        filePath: z.string().min(1).describe("Absolute path to a local ebook file."),
        remoteName: z.string().min(1).optional().describe("Optional filename to use in PocketBook Cloud."),
        contentType: z.string().min(1).optional().describe("Optional content type override."),
      },
    },
    async ({ filePath, remoteName, contentType }) => {
      const response = await client.uploadFile(filePath, remoteName, contentType);
      return asJson({
        ok: isOk(response.status),
        status: response.status,
        upload: normalizeUploadPayload(response.bodyPreview, remoteName),
      });
    },
  );

  server.registerTool(
    "pocketbook_upload_files",
    {
      title: "Upload multiple files to PocketBook Cloud",
      description: "Upload multiple local ebook files to PocketBook Cloud and return per-file results.",
      inputSchema: {
        files: z
          .array(
            z.object({
              filePath: z.string().min(1).describe("Absolute path to a local ebook file."),
              remoteName: z.string().min(1).optional().describe("Optional filename to use in PocketBook Cloud."),
              contentType: z.string().min(1).optional().describe("Optional content type override."),
            }),
          )
          .min(1)
          .max(50),
      },
    },
    async ({ files }) => {
      const results = await client.uploadFiles(files);
      return asJson({
        ok: results.every((result) => result.ok),
        total: results.length,
        uploaded: results.filter((result) => result.ok).length,
        failed: results.filter((result) => !result.ok).length,
        results: results.map((result) => ({
          filePath: result.filePath,
          remoteName: result.remoteName ?? null,
          ok: result.ok,
          status: result.response?.status ?? null,
          upload: result.response
            ? normalizeUploadPayload(result.response.bodyPreview, result.remoteName)
            : null,
          error: result.error ?? null,
        })),
      });
    },
  );

  server.registerTool(
    "pocketbook_probe_profile",
    {
      title: "Probe PocketBook profile endpoints",
      description: "Try likely profile/account endpoints and return status plus previews.",
      inputSchema: {},
    },
    async () => asJson(await client.probe(unique([config.profilePath, ...DEFAULT_PROFILE_PATHS]))),
  );

  server.registerTool(
    "pocketbook_probe_books",
    {
      title: "Probe PocketBook books endpoints",
      description: "Try likely library/books endpoints and return status plus previews.",
      inputSchema: {},
    },
    async () => asJson(await client.probe(unique([config.booksPath, ...DEFAULT_BOOK_PATHS]))),
  );

  server.registerTool(
    "pocketbook_probe_devices",
    {
      title: "Probe PocketBook devices endpoints",
      description: "Try likely device endpoints and return status plus previews.",
      inputSchema: {},
    },
    async () => asJson(await client.probe(unique([config.devicesPath, ...DEFAULT_DEVICE_PATHS]))),
  );
}

function asJson(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}
