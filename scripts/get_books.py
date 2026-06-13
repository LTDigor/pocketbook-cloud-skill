#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from pocketbook_common import PocketBookClient, books_summary, print_json, run_or_exit
from pocketbook_config import load_config, persist_tokens


def main() -> int:
    parser = argparse.ArgumentParser(description="List PocketBook Cloud books as safe redacted JSON.")
    parser.add_argument("--env-file", type=Path, help="Credential file to read and update.")
    parser.add_argument(
        "--library-path",
        default=None,
        help="PocketBook library API path. Override only for endpoint experiments.",
    )
    args = parser.parse_args()

    client = PocketBookClient(load_config(args.env_file), persist_tokens)
    response = client.list_books(args.library_path)
    summary = books_summary(response)
    print_json(summary)
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    run_or_exit(main)
