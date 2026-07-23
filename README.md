# PocketBook Cloud Skill

Codex skill and Python helpers for PocketBook Cloud operations.

## Setup

```bash
cp .env.example .env
```

Set login/password or token auth in `.env`. Do not commit credentials, tokens,
cookies, downloaded books, or signed URLs.

## Commands

```bash
python3 ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/pocketbook_auth.py config
python3 ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/pocketbook_auth.py login
python3 ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/pocketbook_auth.py refresh-token
python3 ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/upload_ebook.py "/path/book.zip"
python3 ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/delete_ebook.py --fast-hash HASH
python3 ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/get_books.py
```

Use an isolated credential file:

```bash
python3 ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/pocketbook_auth.py login --env-file /path/pocketbook.env
python3 ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/upload_ebook.py --env-file /path/pocketbook.env "/path/book.fb2"
python3 ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/delete_ebook.py --env-file /path/pocketbook.env --fast-hash HASH
python3 ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/get_books.py --env-file /path/pocketbook.env
```

For ZIP archives, upload detects one `.fb2` entry and sends the original archive
as `name.fb2.zip`. Use `--remote-name` when needed.

## Files

- `skills/pocketbook-cloud/SKILL.md` - skill entry point.
- `../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/pocketbook_auth.py` - config, login, refresh, user checks.
- `../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/upload_ebook.py` - upload one ebook.
- `../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/delete_ebook.py` - delete by `fast_hash`.
- `../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/get_books.py` - list books as redacted JSON.
- `tests/test_python_scripts.py` - fake-HTTP tests.

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 -m py_compile ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/pocketbook_config.py ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/pocketbook_common.py ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/pocketbook_auth.py ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/upload_ebook.py ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/delete_ebook.py ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/get_books.py
```

## Install

```bash
sh ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/install.sh
```
