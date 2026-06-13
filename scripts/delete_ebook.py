#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from pocketbook_common import PocketBookClient, delete_summary, load_config, print_json, run_or_exit


def main() -> int:
    parser = argparse.ArgumentParser(description="Delete one PocketBook Cloud ebook by fast_hash.")
    parser.add_argument("--env-file", type=Path, help="Credential file to read and update.")
    parser.add_argument("--fast-hash", required=True, help="PocketBook fast_hash value to delete.")
    args = parser.parse_args()

    client = PocketBookClient(load_config(args.env_file))
    response = client.delete_book(args.fast_hash)
    summary = delete_summary(response)
    if summary["fastHash"] is None:
        summary["fastHash"] = args.fast_hash
    print_json(summary)
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    run_or_exit(main)
