# PocketBook Cloud Skill

Small Codex skill for PocketBook Cloud operations through Python scripts.

## Files

- `skills/pocketbook-cloud/SKILL.md` - canonical Codex skill instructions.
- `.env.example` - credential template.
- `scripts/pocketbook_auth.py` - config, login, refresh-token, and user checks.
- `scripts/upload_ebook.py` - upload one local ebook.
- `scripts/delete_ebook.py` - delete one uploaded ebook by `fast_hash`.
- `scripts/get_books.py` - list all PocketBook Cloud books as safe redacted JSON.
- `scripts/pocketbook_config.py` - environment and ignored `.env` config loading.
- `scripts/pocketbook_common.py` - shared Python client code.
- `tests/test_python_scripts.py` - fake-HTTP tests for the scripts.

## Setup

```bash
cp .env.example .env
```

Set either login/password:

```bash
POCKETBOOK_LOGIN=reader@example.com
POCKETBOOK_PASSWORD=...
```

Or token auth:

```bash
POCKETBOOK_ACCESS_TOKEN=...
POCKETBOOK_REFRESH_TOKEN=...
```

Do not commit `.env`, cookies, tokens, or command output containing signed URLs.

## Commands

Show non-secret config:

```bash
python3 scripts/pocketbook_auth.py config
```

Log in from credentials and persist tokens to `.env`:

```bash
python3 scripts/pocketbook_auth.py login
```

Refresh and persist tokens:

```bash
python3 scripts/pocketbook_auth.py refresh-token
```

Upload one ebook:

```bash
python3 scripts/upload_ebook.py "/absolute/path/book.zip"
```

For ZIP archives, the script detects one `.fb2` entry and uploads the original archive as `name.fb2.zip`. Use `--remote-name` when the archive is ambiguous:

```bash
python3 scripts/upload_ebook.py "/absolute/path/book.zip" --remote-name "Book.fb2.zip"
```

Delete an uploaded ebook:

```bash
python3 scripts/delete_ebook.py --fast-hash HASH
```

List all PocketBook Cloud books:

```bash
python3 scripts/get_books.py
```

The script fetches the PocketBook library, redacts sensitive fields, and prints every book with safe fields such as title, progress, status, id, and `fastHash`.

Use an isolated credential file:

```bash
python3 scripts/pocketbook_auth.py login --env-file /absolute/path/pocketbook.env
python3 scripts/upload_ebook.py --env-file /absolute/path/pocketbook.env "/absolute/path/book.fb2"
python3 scripts/delete_ebook.py --env-file /absolute/path/pocketbook.env --fast-hash HASH
python3 scripts/get_books.py --env-file /absolute/path/pocketbook.env
```

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 -m py_compile scripts/pocketbook_config.py scripts/pocketbook_common.py scripts/pocketbook_auth.py scripts/upload_ebook.py scripts/delete_ebook.py scripts/get_books.py
```

## Install

Standalone install:

```bash
curl -fsSL https://raw.githubusercontent.com/LTDigor/pocketbook-cloud-skill/main/scripts/install.sh | sh
```

The installer downloads the repo to `${CODEX_HOME:-~/.codex}/skills/pocketbook-cloud`, preserves an existing `.env`, verifies Python, marks scripts executable, and creates a root `SKILL.md` symlink to the canonical plugin skill for standalone compatibility.
