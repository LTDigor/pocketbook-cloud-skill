---
name: pocketbook-cloud
description: Use this skill for PocketBook Cloud tasks such as checking account status, refreshing tokens, listing books, probing undocumented API endpoints, and uploading ebook files from the local filesystem. Use the bundled CLI only; do not use UI or browser fallback.
---

# PocketBook Cloud

Use this skill when the user asks Codex to work with PocketBook Cloud. Do not use the browser or UI unless the user explicitly allows it or token refresh fails and the user asks for manual re-authentication.

## Quick Start

Run commands from this skill directory:

```bash
npm install
npm run pocketbook -- user
npm run pocketbook -- list-books --limit 100
```

The CLI prints JSON and reads credentials from environment variables or `.env` through `dotenv`.

## Configuration

Expected variables:

- `POCKETBOOK_ACCESS_TOKEN`
- `POCKETBOOK_REFRESH_TOKEN`
- `POCKETBOOK_WEB_CLIENT_ID`
- `POCKETBOOK_ENV_FILE` absolute path to the `.env` file to update after token refresh

Login variables:

- `POCKETBOOK_LOGIN` or `POCKETBOOK_USERNAME`
- `POCKETBOOK_PASSWORD`

Optional variables:

- `POCKETBOOK_BASE_URL`, default `https://cloud.pocketbook.digital`
- `POCKETBOOK_WEB_CLIENT_SECRET`, default public web client secret
- `POCKETBOOK_LANGUAGE`
- `POCKETBOOK_PROVIDER_ALIAS`
- `POCKETBOOK_SHOP_ID`
- `POCKETBOOK_COOKIE_HEADER`
- `POCKETBOOK_COOKIE_FILE`
- `POCKETBOOK_PROFILE_PATH`
- `POCKETBOOK_BOOKS_PATH`
- `POCKETBOOK_DEVICES_PATH`

For this Mac, the existing credentials may live in `/Users/alfa/Documents/New project 2/.env`. If working from another checkout, set `POCKETBOOK_ENV_FILE` to that path before running commands. The CLI reads the local `.env` first, then also reads `POCKETBOOK_ENV_FILE` when it is set.

## Workflow

1. Start with non-UI commands:

```bash
npm run pocketbook -- config
npm run pocketbook -- user
```

2. If PocketBook returns `Unknown token` or `error_code: 223`, refresh before retrying:

```bash
npm run pocketbook -- refresh-token
```

`refresh-token` calls `POST /api/v1.0/auth/renew-token`, updates the in-process credentials, and writes new tokens to `POCKETBOOK_ENV_FILE` or `.env`.

If token refresh is not usable but `POCKETBOOK_LOGIN`/`POCKETBOOK_USERNAME` and `POCKETBOOK_PASSWORD` are configured, log in without UI:

```bash
npm run pocketbook -- login
```

`login` discovers auth providers with `GET /api/v1.0/auth/login`, posts the password to the selected provider, updates in-process credentials, and writes returned tokens to `POCKETBOOK_ENV_FILE` or `.env`. If multiple providers are available, set `POCKETBOOK_PROVIDER_ALIAS` and/or `POCKETBOOK_SHOP_ID`.

After `login` succeeds, verify the persisted token pair with `npm run pocketbook -- user` and `npm run pocketbook -- refresh-token`.

3. If both refresh and login fail, stop and report the error. Use the browser only when the user allows UI recovery.

## Token setup and renewal

To configure a fresh checkout, either copy `POCKETBOOK_ACCESS_TOKEN` and `POCKETBOOK_REFRESH_TOKEN` from an authenticated PocketBook Cloud session, or set `POCKETBOOK_LOGIN`/`POCKETBOOK_USERNAME` and `POCKETBOOK_PASSWORD` and run:

```bash
npm run pocketbook -- login
```

Set `POCKETBOOK_WEB_CLIENT_ID=qNAx1RDb`, the web client ID used by the public PocketBook Cloud browser app. `POCKETBOOK_WEB_CLIENT_SECRET` can usually be omitted because the CLI has the public web client secret fallback used by the web app.

When a refresh token is valid, update saved credentials with:

```bash
npm run pocketbook -- refresh-token
```

The command persists renewed tokens to `POCKETBOOK_ENV_FILE` when set, otherwise to the local `.env`. Use `--no-persist` only for a dry run.

If refresh returns `Unknown token` or `Invalid refresh token`, prefer `npm run pocketbook -- login` when login/password env variables are configured. Recover through the browser only when login is unavailable or fails and the user allows UI recovery: sign in to `https://cloud.pocketbook.digital`, copy fresh `access_token` and `refresh_token` values from the authenticated browser session storage or an authenticated API request, keep `POCKETBOOK_WEB_CLIENT_ID=qNAx1RDb`, write the values to `.env`, and verify with `npm run pocketbook -- user` followed by `npm run pocketbook -- refresh-token`.

Treat full command output as sensitive because some PocketBook API responses include signed URLs with `access_token` query parameters.

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
- `upload-files --files '[{"filePath":"/absolute/path/book.epub"}]'` - upload a batch and return per-file results.
- `probe-profile`, `probe-books`, `probe-devices` - try likely endpoints for API discovery.

Authenticated commands retry once automatically after a successful token refresh when PocketBook returns `Unknown token`.

`.fb2.zip` files can be uploaded as-is; do not unzip them unless the task requires inspecting the book contents.
