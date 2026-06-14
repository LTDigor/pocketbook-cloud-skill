---
name: pocketbook-cloud
description: Use when the user asks to work with PocketBook Cloud, list uploaded books, show their library, recommend new books, choose what to read, says "порекомендуй книгу" or "что почитать", or needs PocketBook auth/upload/delete scripts. Do not use browser/UI fallback.
---

# PocketBook Cloud

Use this skill when the user asks Codex to work with PocketBook Cloud. Use the bundled Python scripts only. Do not use browser/UI fallback unless the user explicitly allows manual re-authentication.

## Quick Start

This skill requires the full repository/plugin install, not only this Markdown file. The installed skill directory must contain `scripts/` next to the skill instructions, either as a plugin root or as a standalone install created by `scripts/install.sh`.

Run commands from the repository/plugin root that contains `scripts/`:

```bash
python3 scripts/pocketbook_auth.py config
python3 scripts/pocketbook_auth.py login
python3 scripts/upload_ebook.py "/absolute/path/book.zip"
python3 scripts/get_books.py
```

The scripts read credentials from environment variables, `.env`, or `--env-file`.

## Configuration

User-provided login variables:

- `POCKETBOOK_LOGIN` or `POCKETBOOK_USERNAME`
- `POCKETBOOK_PASSWORD`

Generated token variables:

- `POCKETBOOK_ACCESS_TOKEN`
- `POCKETBOOK_REFRESH_TOKEN`

Optional variables:

- `POCKETBOOK_BASE_URL`, default `https://cloud.pocketbook.digital`
- `POCKETBOOK_WEB_CLIENT_ID`, default `qNAx1RDb`
- `POCKETBOOK_WEB_CLIENT_SECRET`
- `POCKETBOOK_ENV_FILE`
- `POCKETBOOK_LANGUAGE`
- `POCKETBOOK_PROVIDER_ALIAS`
- `POCKETBOOK_SHOP_ID`
- `POCKETBOOK_COOKIE_HEADER`
- `POCKETBOOK_COOKIE_FILE`

Keep login/password, tokens, cookies, and signed URLs only in environment variables or ignored `.env` files. Never write real secrets into docs, tests, committed files, or chat output.

## Auth

Log in from credentials and persist tokens:

```bash
python3 scripts/pocketbook_auth.py login
```

Refresh and persist tokens:

```bash
python3 scripts/pocketbook_auth.py refresh-token
```

Check current token:

```bash
python3 scripts/pocketbook_auth.py user
```

If PocketBook returns `Wrong token format`, `Unknown token`, `error_code: 222`, or `error_code: 223`, the upload/delete scripts try token refresh, then password login when credentials are configured. If both fail, stop and report the error.

## Upload

Prefer the upload script for one local ebook:

```bash
python3 scripts/upload_ebook.py "/absolute/path/book.zip"
```

It validates the file, detects a single `.fb2` entry inside ZIP archives, uploads the original archive as `name.fb2.zip`, and prints a redacted JSON summary. It skips slow post-upload library probes unless the user asks for deeper verification.

Use `--remote-name` when needed:

```bash
python3 scripts/upload_ebook.py "/absolute/path/book.zip" --remote-name "Book.fb2.zip"
```

## Get Books

List all PocketBook Cloud books as safe redacted JSON:

```bash
python3 scripts/get_books.py
```

The script does not call an AI model. It reads the library through the current books API, falls back from the legacy files API when needed, recovers auth inside the Python client, and prints every book with safe fields such as title, progress, status, id, and `fastHash`.

## Recommend

When the user asks what to read or asks for a PocketBook recommendation, first get the full safe library list:

```bash
python3 scripts/get_books.py
```

By default, recommend three new books that are not already uploaded to PocketBook Cloud. If the user asks for a specific number, follow that number. If the user explicitly asks for one book or a single pick, recommend one.

Treat the returned list as an exclusion set and as reading-taste context: do not recommend any exact title from the list, even if it is unread or in progress.

Only choose from the returned library when the user explicitly asks to pick from uploaded books, current library, already downloaded books, or similar wording.

The recommendations are not produced by the script; the script only supplies safe book context. In chat, say whether the recommendations are new/not uploaded or chosen from the uploaded library, and give a short reason for each book.

## Delete

Delete only when the user explicitly asks to remove a book or when cleaning up a temporary integration-test upload:

```bash
python3 scripts/delete_ebook.py --fast-hash HASH
```

## Isolated Env Files

Use `--env-file` for tests or separate credential stores:

```bash
python3 scripts/pocketbook_auth.py login --env-file /absolute/path/pocketbook.env
python3 scripts/upload_ebook.py --env-file /absolute/path/pocketbook.env "/absolute/path/book.fb2"
python3 scripts/delete_ebook.py --env-file /absolute/path/pocketbook.env --fast-hash HASH
python3 scripts/get_books.py --env-file /absolute/path/pocketbook.env
```

Set `POCKETBOOK_SKIP_LOCAL_ENV=1` when you must prove the command uses only the provided env file.

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 -m py_compile scripts/pocketbook_config.py scripts/pocketbook_common.py scripts/pocketbook_auth.py scripts/upload_ebook.py scripts/delete_ebook.py scripts/get_books.py
```

`.fb2.zip` files can be uploaded as-is; do not unzip them unless the task requires inspecting the book contents.
