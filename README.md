# PocketBook Cloud Skill

Codex skill for working with PocketBook Cloud without an MCP server.

The skill entrypoint is `SKILL.md`. The deterministic helper CLI lives in `src/cli.ts` and is exposed through:

```bash
npm run pocketbook -- user
npm run pocketbook -- list-books --limit 100
npm run pocketbook -- upload-file --file /absolute/path/book.epub
```

## Setup

```bash
npm install
npm run build
cp .env.example .env
```

`.fb2.zip` files can be uploaded as-is if the task does not require inspecting the archive contents.

## Authentication

Use values copied from an authenticated PocketBook Cloud session:

```bash
POCKETBOOK_ACCESS_TOKEN=...
POCKETBOOK_REFRESH_TOKEN=...
POCKETBOOK_WEB_CLIENT_ID=...
POCKETBOOK_ENV_FILE=/absolute/path/to/.env
```

The CLI reads the local `.env` first, then reads `POCKETBOOK_ENV_FILE` when it is set. This lets the skill reuse an existing PocketBook credential file without copying token values into this checkout.

Optional:

```bash
POCKETBOOK_BASE_URL=https://cloud.pocketbook.digital
POCKETBOOK_COOKIE_HEADER=...
POCKETBOOK_COOKIE_FILE=/absolute/path/to/cookie.txt
```

Do not commit `.env` or cookie files.

### Getting tokens

1. Sign in to `https://cloud.pocketbook.digital` in a browser.
2. Open browser developer tools and inspect the app storage or an authenticated API request.
3. Copy the current `access_token` and `refresh_token` values into `.env`.
4. Set `POCKETBOOK_WEB_CLIENT_ID=qNAx1RDb`. This is the web client ID used by the public PocketBook Cloud browser app.
5. Verify the configuration:

```bash
npm run pocketbook -- config
npm run pocketbook -- user
```

On macOS with Chrome, the PocketBook Cloud web app may store the signed-in session in Chrome Local Storage under the `cloud.pocketbook.digital` origin. If you extract values from Chrome's local storage files, copy only `access_token` and `refresh_token` into `.env`; do not commit or print those values.

### Updating tokens

Use the refresh command while the saved refresh token is still valid:

```bash
npm run pocketbook -- refresh-token
```

By default, the command persists renewed credentials to `POCKETBOOK_ENV_FILE` when it is set, otherwise to the local `.env` file. To test refresh without writing updated tokens:

```bash
npm run pocketbook -- refresh-token --no-persist
```

If an authenticated command returns `Unknown token` or `error_code: 223`, the CLI retries once after a successful refresh. If refresh returns `Unknown token` or `Invalid refresh token`, sign in to PocketBook Cloud again and replace `POCKETBOOK_ACCESS_TOKEN`, `POCKETBOOK_REFRESH_TOKEN`, and `POCKETBOOK_WEB_CLIENT_ID` in `.env`.

Some API responses include signed URLs with `access_token` query parameters. Treat full command output as sensitive when sharing logs.

## Commands

- `config` - show non-secret configuration.
- `status` - request `/`.
- `refresh-token [--refresh-token TOKEN] [--no-persist]` - renew credentials and persist them by default.
- `get --path /api/...` - authenticated GET for API discovery.
- `user` - normalized `/api/v1.0/user`.
- `list-books [--offset N] [--limit N]` - normalized `/api/v1.0/books`.
- `books-info` - `/api/v1.0/stats/books-info`.
- `upload-file --file /absolute/path [--remote-name NAME] [--content-type TYPE]`.
- `upload-files --files '[{"filePath":"/absolute/path/book.epub"}]'`.
- `probe-profile`, `probe-books`, `probe-devices` - try likely endpoints.

Authenticated commands retry once automatically after a successful token refresh when PocketBook returns `Unknown token`.

If refresh returns `Unknown token` or `Invalid refresh token`, the saved browser session is no longer usable. Sign in to `https://cloud.pocketbook.digital` again and replace `POCKETBOOK_ACCESS_TOKEN`, `POCKETBOOK_REFRESH_TOKEN`, and `POCKETBOOK_WEB_CLIENT_ID`.

## Tests

```bash
npm test
npm run typecheck
npm run build
```

Live integration tests are skipped by default:

```bash
POCKETBOOK_RUN_INTEGRATION=1 npm test
```
