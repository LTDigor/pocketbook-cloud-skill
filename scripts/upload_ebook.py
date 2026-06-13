#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from pocketbook_common import PocketBookClient, guess_content_type, print_json, run_or_exit, upload_summary
from pocketbook_config import load_config, persist_tokens


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate credentials, detect FB2 ZIP names, upload one ebook, and print a safe summary.",
    )
    parser.add_argument("file", type=Path, help="Path to the local ebook file.")
    parser.add_argument("--env-file", type=Path, help="Credential file to read and update.")
    parser.add_argument("--remote-name", help="PocketBook remote file name.")
    args = parser.parse_args()

    file_path = args.file.expanduser().resolve()
    validate_file(file_path)
    remote_name = args.remote_name or derive_remote_name(
        file_path,
        list_zip_entries(file_path) if file_path.suffix.lower() == ".zip" else [],
    )

    client = PocketBookClient(load_config(args.env_file), persist_tokens)
    response = client.upload_file(file_path, remote_name, guess_content_type(remote_name))
    summary = upload_summary(response, remote_name)
    print_json(summary)
    return 0 if summary["ok"] else 1


def validate_file(file_path: Path) -> None:
    if not file_path.exists():
        raise RuntimeError(f"File does not exist: {file_path}")
    if not file_path.is_file():
        raise RuntimeError(f"Not a regular file: {file_path}")


def derive_remote_name(file_path: Path, zip_entries: list[str]) -> str:
    if file_path.suffix.lower() != ".zip":
        return file_path.name
    fb2_entries = [entry for entry in zip_entries if entry.lower().endswith(".fb2") and not entry.endswith("/")]
    if len(fb2_entries) == 1:
        return f"{Path(fb2_entries[0]).name}.zip"
    if len(fb2_entries) > 1:
        raise RuntimeError("ZIP archive contains multiple .fb2 files; pass --remote-name explicitly.")
    raise RuntimeError("ZIP archive does not contain an .fb2 file.")


def list_zip_entries(file_path: Path) -> list[str]:
    result = subprocess.run(
        ["unzip", "-Z1", str(file_path)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


if __name__ == "__main__":
    run_or_exit(main)
