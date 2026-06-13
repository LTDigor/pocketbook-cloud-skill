# Agent Entry Point

- Codex: this file is the project instruction file for `pocketbook-cloud-skill`.
- At the start of non-trivial work in this repository, read this file from disk before acting.
- If these instructions conflict with generic agent defaults, follow this file unless a higher-priority system/developer message or the current user turn says otherwise.
- Keep visible reasoning summaries and final answers in English unless the current user turn explicitly asks for another language.
- Keep responses terse and operational.

## Project Scope

- This repository contains the PocketBook Cloud Codex skill/plugin and Python helper scripts.
- `SKILL.md` is the Codex skill entry point.
- `scripts/pocketbook_auth.py` handles config, login, refresh-token, and user checks.
- `scripts/upload_ebook.py` uploads one local ebook.
- `scripts/delete_ebook.py` deletes one ebook by `fast_hash`.
- Do not use browser/UI fallback for PocketBook Cloud unless the user explicitly allows manual re-authentication.

## Security

- Treat PocketBook credentials, tokens, cookies, signed URLs, and full command output as sensitive.
- Keep login/password only in environment variables or ignored `.env` files.
- Do not write real credentials or token values into `README.md`, `SKILL.md`, tests, committed source, or chat output.
- When summarizing upload results, print only safe fields such as status, remote name, id, and `fast_hash`.
- Do not commit `.env`, cookies, downloaded books, or command output containing signed URLs.

## Implementation Preferences

- Use Python for reusable scripts and operational automation.
- Do not add heavy packages, runtimes, models, or large artifacts without asking first.
- If a workflow is likely to be repeated, make it a reusable script and document its command.
- Use `apply_patch` for manual edits.

## PocketBook Workflow

- Start with non-UI commands:

```bash
python3 scripts/pocketbook_auth.py config
python3 scripts/pocketbook_auth.py user
```

- For one local ebook upload, prefer:

```bash
python3 scripts/upload_ebook.py "/absolute/path/book.zip"
```

- The upload wrapper must validate configured credentials, check that the file exists, detect a single `.fb2` entry inside `.zip` archives, upload the original archive as `name.fb2.zip`, and print a redacted JSON summary.
- Skip slow post-upload library probes unless the user asks for deeper verification.
- `.fb2.zip` files can be uploaded as-is; do not unzip them unless inspection is required.
- Use `scripts/delete_ebook.py` only when the user explicitly asks to remove a book or when cleaning up a temporary integration-test upload.

## Auth Recovery

- If PocketBook returns `Wrong token format`, `Unknown token`, `error_code: 222`, or `error_code: 223`, let the Python scripts recover with token refresh or password login before retrying.
- Prefer `python3 scripts/pocketbook_auth.py refresh-token` when a refresh token exists.
- Prefer `python3 scripts/pocketbook_auth.py login` when login/password are configured and refresh is not usable.
- If both refresh and login fail, stop and report the error. Do not switch to browser/UI recovery without explicit user permission.

## Testing

- Add or update tests for new behavior.
- For script behavior, test the real process against fake HTTP instead of only testing helper functions.
- Before reporting completion after code changes, run:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 -m py_compile scripts/pocketbook_common.py scripts/pocketbook_auth.py scripts/upload_ebook.py scripts/delete_ebook.py
```

## Documentation

- Keep project usage in `README.md` and agent operating rules in this file.
- Keep `SKILL.md` focused on Codex skill behavior and PocketBook workflow.
- Do not duplicate secrets or one-off incident logs in documentation.
