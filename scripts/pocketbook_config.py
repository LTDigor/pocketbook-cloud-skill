#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path


DEFAULT_BASE_URL = "https://cloud.pocketbook.digital"
DEFAULT_WEB_CLIENT_ID = "qNAx1RDb"


@dataclass
class Config:
    base_url: str
    access_token: str | None = None
    refresh_token: str | None = None
    username: str | None = None
    password: str | None = None
    provider_alias: str | None = None
    shop_id: str | None = None
    language: str | None = None
    web_client_id: str | None = None
    web_client_secret: str | None = None
    cookie_header: str | None = None
    env_file: Path | None = None

    @property
    def client_id(self) -> str:
        return self.web_client_id or DEFAULT_WEB_CLIENT_ID

    @property
    def client_secret(self) -> str:
        return self.web_client_secret or ""


def load_config(env_file: Path | None = None) -> Config:
    values: dict[str, str] = {}
    local_env = Path(".env")
    if not os.environ.get("POCKETBOOK_SKIP_LOCAL_ENV") and local_env.exists():
        values.update(read_env_file(local_env))
    values.update({key: value for key, value in os.environ.items() if key.startswith("POCKETBOOK_")})
    selected_env_file = env_file or (Path(values["POCKETBOOK_ENV_FILE"]) if values.get("POCKETBOOK_ENV_FILE") else None)
    if selected_env_file:
        selected_env_file = selected_env_file.expanduser().resolve()
        if selected_env_file.exists():
            values.update(read_env_file(selected_env_file))
        values["POCKETBOOK_ENV_FILE"] = str(selected_env_file)

    cookie_header = empty_to_none(values.get("POCKETBOOK_COOKIE_HEADER"))
    cookie_file = empty_to_none(values.get("POCKETBOOK_COOKIE_FILE"))
    if not cookie_header and cookie_file:
        cookie_header = read_cookie_file(Path(cookie_file))

    return Config(
        base_url=normalize_base_url(values.get("POCKETBOOK_BASE_URL") or DEFAULT_BASE_URL),
        access_token=empty_to_none(values.get("POCKETBOOK_ACCESS_TOKEN")),
        refresh_token=empty_to_none(values.get("POCKETBOOK_REFRESH_TOKEN")),
        username=empty_to_none(values.get("POCKETBOOK_USERNAME")) or empty_to_none(values.get("POCKETBOOK_LOGIN")),
        password=empty_to_none(values.get("POCKETBOOK_PASSWORD")),
        provider_alias=empty_to_none(values.get("POCKETBOOK_PROVIDER_ALIAS")),
        shop_id=empty_to_none(values.get("POCKETBOOK_SHOP_ID")),
        language=empty_to_none(values.get("POCKETBOOK_LANGUAGE")),
        web_client_id=empty_to_none(values.get("POCKETBOOK_WEB_CLIENT_ID")),
        web_client_secret=empty_to_none(values.get("POCKETBOOK_WEB_CLIENT_SECRET")),
        cookie_header=cookie_header,
        env_file=Path(values["POCKETBOOK_ENV_FILE"]) if values.get("POCKETBOOK_ENV_FILE") else None,
    )


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def persist_tokens(config: Config) -> Path:
    env_file = config.env_file or Path(".env").resolve()
    updates = {
        "POCKETBOOK_ACCESS_TOKEN": config.access_token,
        "POCKETBOOK_REFRESH_TOKEN": config.refresh_token,
    }
    update_env_file(env_file, updates)
    return env_file


def update_env_file(path: Path, updates: dict[str, str | None]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text().splitlines() if path.exists() else []
    seen: set[str] = set()
    output: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            output.append(line)
            continue
        key, _value = line.split("=", 1)
        key = key.strip()
        if key in updates and updates[key]:
            output.append(f'{key}="{escape_env_value(updates[key] or "")}"')
            seen.add(key)
        else:
            output.append(line)
    for key, value in updates.items():
        if key not in seen and value:
            output.append(f'{key}="{escape_env_value(value)}"')
    path.write_text("\n".join(output).rstrip() + "\n")


def escape_env_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def read_cookie_file(path: Path) -> str | None:
    raw = path.expanduser().read_text().strip()
    if not raw:
        return None
    if raw.startswith("{"):
        parsed = json.loads(raw)
        cookie = parsed.get("cookie") if isinstance(parsed, dict) else None
        return cookie.strip() if isinstance(cookie, str) and cookie.strip() else None
    return re.sub(r"^cookie:\s*", "", raw, flags=re.I).strip()


def empty_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def normalize_base_url(value: str) -> str:
    return value.strip().rstrip("/")
