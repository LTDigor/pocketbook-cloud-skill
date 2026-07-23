# Agent Instructions

Read this file before non-trivial work in `pocketbook-cloud-skill`.

## Scope

This repository contains the PocketBook Cloud Codex skill and Python helper
scripts. `SKILL.md` is the skill entry point.

## Security

- Treat credentials, tokens, cookies, signed URLs, and full command output as sensitive.
- Store login/password only in environment variables or ignored `.env` files.
- Do not write real secrets to README, skill files, tests, source, or chat.
- Summaries may include only safe fields: status, remote name, id, `fast_hash`.
- Do not commit `.env`, cookies, downloaded books, or signed URLs.

## Workflow

- Use non-UI scripts first: `pocketbook_auth.py`, `upload_ebook.py`,
  `delete_ebook.py`, `get_books.py`.
- Do not use browser/UI fallback unless the user explicitly allows manual auth.
- Let auth scripts recover `Wrong token format`, `Unknown token`,
  `error_code: 222`, and `error_code: 223` through refresh or password login.
- Use Python for reusable automation.
- Do not add heavy dependencies without asking.
- Do not add new project script sources under repo-local `scripts/`. Store reusable helper scripts under `../ObsidianVault/scripts/projects/pocketbook-cloud-skill/` and call them from docs or skills with repository-relative paths.

## Testing

For code changes, run:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 -m py_compile ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/pocketbook_config.py ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/pocketbook_common.py ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/pocketbook_auth.py ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/upload_ebook.py ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/delete_ebook.py ../ObsidianVault/scripts/projects/pocketbook-cloud-skill/scripts/get_books.py
```
