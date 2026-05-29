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

Use values copied from authenticated PocketBook Cloud requests:

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
