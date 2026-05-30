---
name: pocketbook-cloud
description: Use this skill for PocketBook Cloud tasks such as checking account status, refreshing tokens, listing books, probing undocumented API endpoints, and uploading ebook files from the local filesystem. Use the bundled CLI only; do not use UI or browser fallback.
---

# PocketBook Cloud

Use this skill when the user asks Codex to work with PocketBook Cloud. Do not use the browser or UI unless the user explicitly allows it or token refresh fails and the user asks for manual re-authentication.

## Quick Start

Run commands from the plugin or repository root (the directory containing `package.json`):

```bash
npm install
npm run pocketbook -- user
npm run pocketbook -- list-books --limit 100
```

The CLI prints JSON and reads credentials from environment variables or `.env` through `dotenv`.

## Configuration

User-provided login variables:

- `POCKETBOOK_LOGIN` or `POCKETBOOK_USERNAME`
- `POCKETBOOK_PASSWORD`

Keep login/password only in environment variables or `.env` files. Do not write actual credentials into `SKILL.md`, README files, tests, or committed source.

Generated token variables:

- `POCKETBOOK_ACCESS_TOKEN`
- `POCKETBOOK_REFRESH_TOKEN`

The CLI writes generated tokens after `login` or `refresh-token`. Do not ask the user to provide token values unless password login is unavailable.

Optional variables:

- `POCKETBOOK_BASE_URL`, default `https://cloud.pocketbook.digital`
- `POCKETBOOK_WEB_CLIENT_ID`, default `qNAx1RDb`
- `POCKETBOOK_WEB_CLIENT_SECRET`, defaults to the public web client secret used by the PocketBook Cloud browser app
- `POCKETBOOK_ENV_FILE` absolute path to a `.env` file to update after token refresh or login
- `POCKETBOOK_LANGUAGE`
- `POCKETBOOK_PROVIDER_ALIAS`
- `POCKETBOOK_SHOP_ID`
- `POCKETBOOK_COOKIE_HEADER`
- `POCKETBOOK_COOKIE_FILE`
- `POCKETBOOK_PROFILE_PATH`
- `POCKETBOOK_BOOKS_PATH`
- `POCKETBOOK_DEVICES_PATH`

The CLI reads the local `.env` first, then also reads `POCKETBOOK_ENV_FILE` when it is set. Use `POCKETBOOK_ENV_FILE` to reuse an existing credential file without copying token values into this checkout.

## Workflow

1. Start with non-UI commands:

```bash
npm run pocketbook -- config
npm run pocketbook -- login
npm run pocketbook -- user
```

2. If PocketBook returns `Wrong token format`, `Unknown token`, `error_code: 222`, or `error_code: 223`, let the CLI recover before retrying:

```bash
npm run pocketbook -- refresh-token
```

Authenticated commands first try token refresh, then fall back to password login when `POCKETBOOK_LOGIN`/`POCKETBOOK_USERNAME` and `POCKETBOOK_PASSWORD` are configured. Successful recovery updates the in-process credentials and writes new tokens to `POCKETBOOK_ENV_FILE` or `.env`.

If token refresh is not usable, log in without UI when `POCKETBOOK_LOGIN`/`POCKETBOOK_USERNAME` and `POCKETBOOK_PASSWORD` are configured:

```bash
npm run pocketbook -- login
```

`login` discovers auth providers with `GET /api/v1.0/auth/login`, posts the password to the selected provider, updates in-process credentials, and writes returned tokens to `POCKETBOOK_ENV_FILE` or `.env`. If multiple providers are available, set `POCKETBOOK_PROVIDER_ALIAS` and/or `POCKETBOOK_SHOP_ID`.

After `login` succeeds, verify the persisted token pair with `npm run pocketbook -- user` and `npm run pocketbook -- refresh-token`.

3. If both refresh and login fail, stop and report the error. Use the browser only when the user allows UI recovery.

## Token setup and renewal

To configure a fresh checkout, set `POCKETBOOK_LOGIN`/`POCKETBOOK_USERNAME` and `POCKETBOOK_PASSWORD`, then run:

```bash
npm run pocketbook -- login
```

The CLI uses `POCKETBOOK_WEB_CLIENT_ID=qNAx1RDb` and the public PocketBook Cloud browser app client secret by default. Override `POCKETBOOK_WEB_CLIENT_SECRET` only if the web app changes.

When a refresh token is valid, update saved credentials with:

```bash
npm run pocketbook -- refresh-token
```

The command persists renewed tokens to `POCKETBOOK_ENV_FILE` when set, otherwise to the local `.env`. Use `--no-persist` only for a dry run.

If refresh returns `Unknown token` or `Invalid refresh token`, prefer `npm run pocketbook -- login` when login/password env variables are configured. Recover through the browser only when login is unavailable or fails and the user allows UI recovery: sign in to `https://cloud.pocketbook.digital`, copy fresh `access_token` and `refresh_token` values from the authenticated browser session storage or an authenticated API request, write the values to `.env`, and verify with `npm run pocketbook -- user` followed by `npm run pocketbook -- refresh-token`.

Treat full command output as sensitive because some PocketBook API responses include signed URLs with `access_token` query parameters.

## Delete Books

Use `delete-book` only when the user explicitly asks to remove a book or when cleaning up a temporary integration-test upload. Find the book's `fast_hash` first, then delete by hash:

```bash
npm run pocketbook -- get --path /api/v1.0/fileops/info/
npm run pocketbook -- delete-book --fast-hash HASH
```

After deletion, verify removal with `GET /api/v1.0/fileops/info/?fast_hash=HASH`; PocketBook returns `404` when the file is gone. Do not delete user books by guessed title alone.

## Commands

- `config` - show non-secret configuration.
- `status` - request `/`.
- `login [--username LOGIN] [--password PASSWORD] [--provider-alias ALIAS] [--shop-id ID] [--language LANG] [--no-persist]` - log in with env or option credentials and persist returned tokens.
- `refresh-token [--refresh-token TOKEN] [--no-persist]` - renew credentials.
- `get --path /api/...` - authenticated GET for API discovery.
- `user` - normalized `/api/v1.0/user`.
- `list-books [--offset N] [--limit N]` - normalized `/api/v1.0/books`.
- `books-info` - `/api/v1.0/stats/books-info`.
- `upload-file --file /absolute/path [--remote-name NAME] [--content-type TYPE]` - upload one ebook with `PUT /api/v1.1/files/{name}`.
- `delete-book --fast-hash HASH` - delete one ebook with `POST /api/v1.1/fileops/delete/?fast_hash={hash}`.
- `upload-files --files '[{"filePath":"/absolute/path/book.epub"}]'` - upload a batch and return per-file results.
- `probe-profile`, `probe-books`, `probe-devices` - try likely endpoints for API discovery.

Authenticated commands retry once automatically after successful token refresh or password login recovery when PocketBook returns `Wrong token format` or `Unknown token`.

`.fb2.zip` files can be uploaded as-is; do not unzip them unless the task requires inspecting the book contents.
