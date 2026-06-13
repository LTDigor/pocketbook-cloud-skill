#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = "https://cloud.pocketbook.digital"
DEFAULT_WEB_CLIENT_ID = "qNAx1RDb"
DEFAULT_WEB_CLIENT_SECRET = "K3YYSjCgDJNoWKdGVOyO1mrROp3MMZqqRNXNXTmh"
REDACTED = "[redacted]"
SENSITIVE_KEY_RE = re.compile(r"(^|_|-)(access[_-]?token|refresh[_-]?token|token|password|authorization|cookie|secret)($|_|-)", re.I)


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
        return self.web_client_secret or DEFAULT_WEB_CLIENT_SECRET


@dataclass
class Response:
    url: str
    status: int
    status_text: str
    content_type: str
    body: Any


class PocketBookError(RuntimeError):
    pass


class PocketBookClient:
    def __init__(self, config: Config):
        self.config = config

    def config_summary(self) -> dict[str, Any]:
        return {
            "baseUrl": self.config.base_url,
            "hasAccessToken": bool(self.config.access_token),
            "hasRefreshToken": bool(self.config.refresh_token),
            "hasUsername": bool(self.config.username),
            "hasPassword": bool(self.config.password),
            "hasWebClientId": bool(self.config.web_client_id),
            "hasWebClientSecret": bool(self.config.web_client_secret),
            "hasCookie": bool(self.config.cookie_header),
            "hasEnvFilePath": bool(self.config.env_file),
        }

    def request(self, method: str, path: str, body: bytes | None = None, content_type: str | None = None) -> Response:
        headers = {
            "accept": "application/json, text/plain, */*",
            "user-agent": "pocketbook-cloud-skill/0.1",
            "cache-control": "no-cache",
        }
        if self.config.access_token:
            headers["authorization"] = f"Bearer {self.config.access_token}"
        if self.config.web_client_id:
            headers["x-web-client"] = self.config.web_client_id
        if self.config.cookie_header:
            headers["cookie"] = self.config.cookie_header
        if content_type:
            headers["content-type"] = content_type

        request = Request(self.to_url(path), method=method, data=body, headers=headers)
        url = self.to_url(path)
        try:
            with urlopen(request, timeout=60) as response:
                raw = response.read()
                return Response(
                    url=response.geturl(),
                    status=response.status,
                    status_text=response.reason,
                    content_type=response.headers.get("content-type", ""),
                    body=parse_body(raw, response.headers.get("content-type", "")),
                )
        except HTTPError as error:
            raw = error.read()
            return Response(
                url=error.geturl(),
                status=error.code,
                status_text=error.reason,
                content_type=error.headers.get("content-type", ""),
                body=parse_body(raw, error.headers.get("content-type", "")),
            )
        except (URLError, OSError):
            return self.curl_request(method, url, headers, body)

    def curl_request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
    ) -> Response:
        with tempfile.NamedTemporaryFile() as body_file:
            command = [
                "curl",
                "--silent",
                "--show-error",
                "--location",
                "--max-time",
                "60",
                "--request",
                method,
                "--output",
                body_file.name,
                "--write-out",
                "\\n%{http_code}\\n%{content_type}\\n%{url_effective}",
            ]
            for key, value in headers.items():
                command.extend(["--header", f"{key}: {value}"])
            if body is not None:
                command.extend(["--data-binary", "@-"])
            command.append(url)
            result = subprocess.run(command, input=body, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            if result.returncode != 0:
                stderr = result.stderr.decode(errors="replace").strip()
                raise PocketBookError(stderr or f"curl failed with exit code {result.returncode}")
            meta = result.stdout.decode(errors="replace").splitlines()
            status = int(meta[-3]) if len(meta) >= 3 and meta[-3].isdigit() else 0
            content_type = meta[-2] if len(meta) >= 2 else ""
            effective_url = meta[-1] if meta else url
            raw = Path(body_file.name).read_bytes()
            return Response(
                url=effective_url,
                status=status,
                status_text="",
                content_type=content_type,
                body=parse_body(raw, content_type),
            )

    def to_url(self, path: str) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            base_origin = origin(self.config.base_url)
            path_origin = origin(path)
            if path_origin != base_origin:
                raise PocketBookError(f"Refusing to send PocketBook credentials to a different origin: {path_origin}")
            return path
        normalized = path if path.startswith("/") else f"/{path}"
        return f"{self.config.base_url.rstrip('/')}{normalized}"

    def auth_providers(self) -> list[dict[str, Any]]:
        if not self.config.username:
            raise PocketBookError("POCKETBOOK_LOGIN or POCKETBOOK_USERNAME is required to discover auth providers.")
        params = {
            "username": self.config.username,
            "client_id": self.config.client_id,
            "client_secret": self.config.client_secret,
        }
        if self.config.language:
            params["language"] = self.config.language
        response = self.request("GET", f"/api/v1.0/auth/login?{urlencode(params)}")
        if not is_ok(response.status):
            raise PocketBookError(f"PocketBook auth provider discovery failed with HTTP {response.status}.")
        body = response.body if isinstance(response.body, dict) else {}
        providers = body.get("providers") or body.get("auth-providers")
        if not isinstance(providers, list) and isinstance(body.get("data"), dict):
            providers = body["data"].get("providers") or body["data"].get("auth-providers")
        return [provider for provider in providers or [] if isinstance(provider, dict)]

    def login(self) -> Response:
        if not self.config.username:
            raise PocketBookError("POCKETBOOK_LOGIN or POCKETBOOK_USERNAME is required to log in.")
        if not self.config.password:
            raise PocketBookError("POCKETBOOK_PASSWORD is required to log in.")
        provider = select_provider(self.auth_providers(), self.config.provider_alias, self.config.shop_id)
        alias = str(provider.get("alias") or "").strip()
        shop_id = str(provider.get("shop_id") or provider.get("shopId") or "").strip()
        if not alias or not shop_id:
            raise PocketBookError("Selected PocketBook auth provider is missing alias or shop_id.")
        form = {
            "shop_id": shop_id,
            "username": self.config.username,
            "password": self.config.password,
            "client_id": self.config.client_id,
            "client_secret": self.config.client_secret,
            "grant_type": "password",
        }
        if self.config.language:
            form["language"] = self.config.language
        response = self.request(
            "POST",
            f"/api/v1.0/auth/login/{alias}",
            urlencode(form).encode(),
            "application/x-www-form-urlencoded",
        )
        self.update_tokens_from_response(response)
        return response

    def refresh_token(self) -> Response:
        if not self.config.refresh_token:
            raise PocketBookError("POCKETBOOK_REFRESH_TOKEN is required to renew PocketBook Cloud auth.")
        form = {
            "grant_type": "refresh_token",
            "refresh_token": self.config.refresh_token,
        }
        response = self.request(
            "POST",
            "/api/v1.0/auth/renew-token",
            urlencode(form).encode(),
            "application/x-www-form-urlencoded",
        )
        self.update_tokens_from_response(response)
        return response

    def update_tokens_from_response(self, response: Response) -> None:
        if not is_ok(response.status) or not isinstance(response.body, dict):
            return
        access_token = str_or_none(response.body.get("access_token"))
        refresh_token = str_or_none(response.body.get("refresh_token"))
        if access_token:
            self.config.access_token = access_token
        if refresh_token:
            self.config.refresh_token = refresh_token

    def recover_auth(self) -> bool:
        if self.config.refresh_token:
            response = self.refresh_token()
            if is_ok(response.status) and self.config.access_token:
                persist_tokens(self.config)
                return True
        if self.config.username and self.config.password:
            response = self.login()
            if is_ok(response.status) and self.config.access_token:
                persist_tokens(self.config)
                return True
        return False

    def authenticated(self, operation):
        response = operation()
        if is_recoverable_auth_error(response) and self.recover_auth():
            return operation()
        return response

    def user(self) -> Response:
        return self.authenticated(lambda: self.request("GET", "/api/v1.0/user"))

    def upload_file(self, file_path: Path, remote_name: str, content_type: str | None = None) -> Response:
        safe_name = quote_path_segment(remote_name)
        data = file_path.read_bytes()
        return self.authenticated(
            lambda: self.request("PUT", f"/api/v1.1/files/{safe_name}", data, content_type or guess_content_type(remote_name)),
        )

    def delete_book(self, fast_hash: str) -> Response:
        if not fast_hash.strip():
            raise PocketBookError("A non-empty PocketBook fast_hash is required to delete a book.")
        params = urlencode({"fast_hash": fast_hash.strip()})
        return self.authenticated(lambda: self.request("POST", f"/api/v1.1/fileops/delete/?{params}"))


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


def auth_result(response: Response, config: Config, persisted: Path | None = None) -> dict[str, Any]:
    body = response.body if isinstance(response.body, dict) else {}
    return {
        "ok": is_ok(response.status),
        "status": response.status,
        "statusText": response.status_text,
        "persisted": persisted is not None,
        "envFilePath": str(persisted) if persisted else None,
        "tokens": {
            "hasAccessToken": bool(config.access_token),
            "hasRefreshToken": bool(config.refresh_token),
            "accessTokenLength": len(config.access_token or ""),
            "refreshTokenLength": len(config.refresh_token or ""),
            "expiresIn": body.get("expires_in") if isinstance(body.get("expires_in"), int) else None,
            "tokenType": body.get("token_type") if isinstance(body.get("token_type"), str) else None,
        },
        "error": error_message(body),
    }


def upload_summary(response: Response, remote_name: str) -> dict[str, Any]:
    body = response.body if isinstance(response.body, dict) else {}
    return {
        "ok": is_ok(response.status),
        "status": response.status,
        "remoteName": remote_name,
        "id": body.get("id") if isinstance(body.get("id"), (str, int)) else None,
        "path": body.get("path") if isinstance(body.get("path"), str) else None,
        "bytes": body.get("bytes") if isinstance(body.get("bytes"), (str, int)) else None,
        "mimeType": body.get("mime_type") if isinstance(body.get("mime_type"), str) else None,
        "fastHash": body.get("fast_hash") if isinstance(body.get("fast_hash"), str) else None,
        "error": error_message(body),
    }


def delete_summary(response: Response) -> dict[str, Any]:
    body = response.body if isinstance(response.body, dict) else {}
    return {
        "ok": is_ok(response.status),
        "status": response.status,
        "deleted": body.get("deleted") if isinstance(body.get("deleted"), bool) else is_ok(response.status),
        "fastHash": body.get("fast_hash") if isinstance(body.get("fast_hash"), str) else None,
        "error": error_message(body),
    }


def print_json(payload: dict[str, Any]) -> None:
    print(json.dumps(sanitize(payload), indent=2))


def sanitize(value: Any, key: str = "") -> Any:
    if SENSITIVE_KEY_RE.search(key):
        return REDACTED
    if isinstance(value, dict):
        return {entry_key: sanitize(entry_value, entry_key) for entry_key, entry_value in value.items()}
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str):
        return re.sub(r"([?&](?:access_token|refresh_token|token)=)[^&\s\"]+", rf"\1{REDACTED}", value, flags=re.I)
    return value


def select_provider(providers: list[dict[str, Any]], alias: str | None, shop_id: str | None) -> dict[str, Any]:
    if not providers:
        raise PocketBookError("PocketBook did not return any auth providers for this login.")
    for provider in providers:
        provider_alias = str_or_none(provider.get("alias"))
        provider_shop_id = str_or_none(provider.get("shop_id")) or str_or_none(provider.get("shopId"))
        if (not alias or provider_alias == alias) and (not shop_id or provider_shop_id == shop_id):
            return provider
    available = ", ".join(
        "/".join(filter(None, [str_or_none(provider.get("alias")), str_or_none(provider.get("shop_id")), str_or_none(provider.get("name"))]))
        for provider in providers
    )
    raise PocketBookError(f"No PocketBook auth provider matched the configured selector. Available providers: {available}")


def parse_body(raw: bytes, content_type: str) -> Any:
    text = raw.decode(errors="replace")
    if "application/json" in content_type:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text
    return text


def is_recoverable_auth_error(response: Response) -> bool:
    return response.status == 403 and isinstance(response.body, dict) and response.body.get("error_code") in {222, 223}


def is_ok(status: int) -> bool:
    return 200 <= status < 300


def error_message(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    for key in ("error", "message", "error_description"):
        value = body.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def str_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, int):
        return str(value)
    return None


def empty_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def normalize_base_url(value: str) -> str:
    return value.strip().rstrip("/")


def origin(value: str) -> str:
    parsed = urlparse(value)
    return f"{parsed.scheme}://{parsed.netloc}"


def quote_path_segment(value: str) -> str:
    from urllib.parse import quote

    return quote(value.strip(), safe="")


def guess_content_type(file_name: str) -> str:
    lower = file_name.lower()
    if lower.endswith(".fb2.zip"):
        return "application/zip"
    if lower.endswith(".fb2"):
        return "application/x-fictionbook+xml"
    if lower.endswith(".epub"):
        return "application/epub+zip"
    if lower.endswith(".pdf"):
        return "application/pdf"
    if lower.endswith(".txt"):
        return "text/plain"
    return "application/octet-stream"


def run_or_exit(main) -> None:
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
