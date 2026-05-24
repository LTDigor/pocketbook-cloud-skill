# PocketBook MCP

MCP server for exploring and integrating with a PocketBook account.

PocketBook Cloud has a web app at `https://cloud.pocketbook.digital`, but a public API contract is not documented. This server therefore starts with safe discovery tools and can be pinned to real endpoints after inspecting authenticated browser requests.

This README documents the MCP server, authentication, configuration, tools, and runtime behavior.

## Setup

```bash
npm install
npm run build
cp .env.example .env
```

`.fb2.zip` файлы можно не распаковывать, если для задачи не нужен доступ к содержимому внутри архива.

## Authentication

Use values copied from authenticated PocketBook Cloud requests:

1. Open `https://cloud.pocketbook.digital` in a browser and sign in.
2. Open DevTools, go to Network, refresh the page or open the library.
3. Pick a PocketBook request to `/api/v1.0/...` or `/api/v1.1/...`.
4. Copy the `Authorization: Bearer ...` value and `X-WEB-CLIENT`.
5. Also copy the stored `refresh_token` value from browser local storage if it is present.
6. Put them into `.env`:

```bash
POCKETBOOK_ACCESS_TOKEN=...
POCKETBOOK_REFRESH_TOKEN=...
POCKETBOOK_WEB_CLIENT_ID=...
POCKETBOOK_ENV_FILE=/absolute/path/to/pocketbook-mcp/.env
```

Cookies are optional for the API calls observed so far, but can still be supplied:

```bash
POCKETBOOK_COOKIE_HEADER=...
```

Do not commit `.env` or cookie files.

### Refreshing tokens

PocketBook access tokens expire quickly. Keep both tokens in `.env`:

```bash
POCKETBOOK_ACCESS_TOKEN=...
POCKETBOOK_REFRESH_TOKEN=...
POCKETBOOK_WEB_CLIENT_ID=...
POCKETBOOK_ENV_FILE=/Users/alfa/Documents/New project 2/.env
```

Then call the MCP tool:

```json
{
  "tool": "pocketbook_refresh_token",
  "arguments": {
    "persist": true
  }
}
```

The tool calls `POST /api/v1.0/auth/renew-token` with `grant_type=refresh_token`.
If PocketBook returns new tokens, the tool writes them back to `POCKETBOOK_ENV_FILE`
or to `.env` in the MCP server working directory. The tool response reports only
token presence and lengths, not token values.

The running MCP server also switches to the refreshed tokens immediately, so a
restart is not needed after calling `pocketbook_refresh_token`. Authenticated
tools such as `pocketbook_user`, `pocketbook_list_books`, and
`pocketbook_upload_file` retry once automatically when PocketBook returns
`Unknown token`: they refresh credentials, persist them, and repeat the request.

If you edit `.env` manually outside the MCP server, the already-running process
does not hot-reload that file. Call `pocketbook_refresh_token` with a valid
configured refresh token, or restart the MCP server to load manual edits.

If refresh returns `Unknown token` or `Invalid refresh token`, the saved browser
session is no longer usable. Sign in to `https://cloud.pocketbook.digital` again
and replace `POCKETBOOK_ACCESS_TOKEN`, `POCKETBOOK_REFRESH_TOKEN`, and
`POCKETBOOK_WEB_CLIENT_ID` from an authenticated request/local storage.

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
        "POCKETBOOK_REFRESH_TOKEN": "paste-refresh-token-here",
        "POCKETBOOK_WEB_CLIENT_ID": "paste-web-client-id-here"
      }
    }
  }
}
```

For Codex on this Mac, prefer the wrapper script so every new session starts the
server from the project directory and reads `/Users/alfa/Documents/New project 2/.env`:

```toml
[mcp_servers.pocketbook]
command = "/Users/alfa/Documents/New project 2/bin/pocketbook-mcp"
```

## Tools

- `pocketbook_config` - shows non-secret configuration.
- `pocketbook_cloud_status` - checks Cloud reachability.
- `pocketbook_refresh_token` - renews access credentials and can persist them to `.env`.
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

Live integration tests are included and are skipped by default.
Run them explicitly with:

```bash
POCKETBOOK_RUN_INTEGRATION=1 npm test
```
