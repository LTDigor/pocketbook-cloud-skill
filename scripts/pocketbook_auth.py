#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from pocketbook_common import PocketBookClient, auth_result, print_json, run_or_exit
from pocketbook_config import load_config, persist_tokens


def main() -> int:
    parser = argparse.ArgumentParser(description="Authenticate with PocketBook Cloud and persist token values.")
    parser.add_argument("command", choices=["config", "login", "refresh-token", "user"])
    parser.add_argument("--env-file", type=Path, help="Credential file to read and update.")
    parser.add_argument("--no-persist", action="store_true", help="Do not write returned tokens.")
    args = parser.parse_args()

    config = load_config(args.env_file)
    client = PocketBookClient(config, persist_tokens)

    if args.command == "config":
        print_json(client.config_summary())
        return 0
    if args.command == "login":
        response = client.login()
        persisted = None if args.no_persist or not config.access_token else persist_tokens(config)
        print_json(auth_result(response, config, persisted))
        return 0 if 200 <= response.status < 300 else 1
    if args.command == "refresh-token":
        response = client.refresh_token()
        persisted = None if args.no_persist or not config.access_token else persist_tokens(config)
        print_json(auth_result(response, config, persisted))
        return 0 if 200 <= response.status < 300 else 1
    if args.command == "user":
        response = client.user()
        print_json({"ok": 200 <= response.status < 300, "status": response.status, "user": response.body})
        return 0 if 200 <= response.status < 300 else 1
    raise AssertionError(args.command)


if __name__ == "__main__":
    run_or_exit(main)
