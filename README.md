# PocketBook MCP

MCP server for exploring and integrating with a PocketBook account.

PocketBook Cloud has a web app at `https://cloud.pocketbook.digital`, but a public API contract is not documented. This server therefore starts with safe discovery tools and can be pinned to real endpoints after inspecting authenticated browser requests.

## Setup

```bash
npm install
npm run build
cp .env.example .env
```

## Authentication

Use values copied from authenticated PocketBook Cloud requests:

1. Open `https://cloud.pocketbook.digital` in a browser and sign in.
2. Open DevTools, go to Network, refresh the page or open the library.
3. Pick a PocketBook request to `/api/v1.0/...` or `/api/v1.1/...`.
4. Copy the `Authorization: Bearer ...` value and `X-WEB-CLIENT`.
5. Put them into `.env`:

```bash
POCKETBOOK_ACCESS_TOKEN=...
POCKETBOOK_WEB_CLIENT_ID=...
```

Cookies are optional for the API calls observed so far, but can still be supplied:

```bash
POCKETBOOK_COOKIE_HEADER=...
```

Do not commit `.env` or cookie files.

## MCP client config

Use the built server through stdio:

```json
{
  "mcpServers": {
    "pocketbook": {
      "command": "node",
      "args": ["/absolute/path/to/pocketbook-mcp/dist/index.js"],
      "env": {
        "POCKETBOOK_BASE_URL": "https://cloud.pocketbook.digital",
        "POCKETBOOK_ACCESS_TOKEN": "paste-access-token-here",
        "POCKETBOOK_WEB_CLIENT_ID": "paste-web-client-id-here"
      }
    }
  }
}
```

## Tools

- `pocketbook_config` - shows non-secret configuration.
- `pocketbook_cloud_status` - checks Cloud reachability.
- `pocketbook_get` - performs an authenticated GET request for API discovery.
- `pocketbook_user` - gets the authenticated user profile from `/api/v1.0/user`.
- `pocketbook_list_books` - lists books from `/api/v1.0/books?offset=...&limit=...`.
- `pocketbook_books_info` - gets `/api/v1.0/stats/books-info`.
- `pocketbook_upload_file` - uploads an ebook with `PUT /api/v1.1/files/{filename}`.
- `pocketbook_upload_files` - uploads several ebook files and returns a per-file report.
- `pocketbook_probe_profile` - tries likely profile/account endpoints.
- `pocketbook_probe_books` - tries likely library/books endpoints.
- `pocketbook_probe_devices` - tries likely device endpoints.

After real endpoints are confirmed, pin them with:

```bash
POCKETBOOK_PROFILE_PATH=/real/profile/path
POCKETBOOK_BOOKS_PATH=/real/books/path
POCKETBOOK_DEVICES_PATH=/real/devices/path
```

## Tests

```bash
npm test
npm run typecheck
npm run build
```

Live integration tests are included and are skipped unless `POCKETBOOK_ACCESS_TOKEN` is present in `.env` or the process environment.
