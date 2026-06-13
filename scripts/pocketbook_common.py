#!/usr/bin/env python3
from __future__ import annotations

import json
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

from pocketbook_config import Config


REDACTED = "[redacted]"
SENSITIVE_KEY_RE = re.compile(r"(^|_|-)(access[_-]?token|refresh[_-]?token|token|password|authorization|cookie|secret)($|_|-)", re.I)
DEFAULT_BOOKS_PATH = "/api/v1.0/books?limit=500"
LEGACY_FILES_PATH = "/api/v1.1/files/"


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
    def __init__(self, config: Config, token_persister=None):
        self.config = config
        self.token_persister = token_persister

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
                self.persist_recovered_tokens()
                return True
        if self.config.username and self.config.password:
            response = self.login()
            if is_ok(response.status) and self.config.access_token:
                self.persist_recovered_tokens()
                return True
        return False

    def persist_recovered_tokens(self) -> None:
        if self.token_persister:
            self.token_persister(self.config)

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

    def list_books(self, path: str | None = None) -> Response:
        selected_path = path or DEFAULT_BOOKS_PATH
        response = self.authenticated(lambda: self.request("GET", selected_path))
        if is_legacy_files_path(selected_path) and not is_ok(response.status):
            return self.authenticated(lambda: self.request("GET", DEFAULT_BOOKS_PATH))
        return response

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


def books_summary(response: Response) -> dict[str, Any]:
    body = response.body if isinstance(response.body, (dict, list)) else {}
    books = extract_books(body)
    return {
        "ok": is_ok(response.status),
        "status": response.status,
        "mode": "books",
        "count": len(books),
        "finishedCount": count_finished_books(books),
        "books": [book_summary(book) for book in books],
        "error": error_message(body),
    }


def extract_books(body: Any) -> list[dict[str, Any]]:
    if isinstance(body, list):
        return [item for item in body if isinstance(item, dict)]
    if not isinstance(body, dict):
        return []
    for key in ("items", "files", "books", "documents", "entries"):
        value = body.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    data = body.get("data")
    if isinstance(data, (dict, list)):
        return extract_books(data)
    return []


def book_summary(book: dict[str, Any]) -> dict[str, Any]:
    progress = progress_percent(book)
    summary = {
        "title": book_title(book),
        "author": book_author(book),
        "progressPercent": progress,
        "status": book_status(book, progress),
        "id": str_or_none(book.get("id")),
        "fastHash": str_or_none(book.get("fast_hash")) or str_or_none(book.get("fastHash")),
    }
    return {key: value for key, value in summary.items() if value is not None}


def book_status(book: dict[str, Any], progress: int | None = None) -> str:
    resolved_progress = progress if progress is not None else progress_percent(book)
    if is_completed_book(book) or (resolved_progress or 0) >= 99:
        return "finished"
    if (resolved_progress or 0) > 0:
        return "in_progress"
    return "unread"


def count_finished_books(books: list[dict[str, Any]]) -> int:
    return sum(1 for book in books if is_completed_book(book) or (progress_percent(book) or 0) >= 99)


def progress_percent(book: dict[str, Any]) -> int | None:
    for key in ("progressPercent", "progress_percent", "readPercent", "read_percent", "progress", "percent"):
        value = book.get(key)
        if isinstance(value, (int, float)):
            percent = float(value)
        elif isinstance(value, str) and value.strip():
            try:
                percent = float(value.strip().rstrip("%"))
            except ValueError:
                continue
        else:
            continue
        if 0 < percent <= 1:
            percent *= 100
        return max(0, min(100, round(percent)))
    return None


def is_completed_book(book: dict[str, Any]) -> bool:
    for key in ("completed", "finished", "is_read", "isRead"):
        if book.get(key) is True:
            return True
    status = str_or_none(book.get("status")) or str_or_none(book.get("read_status")) or str_or_none(book.get("readStatus"))
    return status.lower() in {"completed", "finished"} if status else False


def book_title(book: dict[str, Any]) -> str | None:
    for key in ("title", "name", "file_name", "filename", "path"):
        value = str_or_none(book.get(key))
        if value:
            return clean_book_title(Path(value).name)
    return None


def clean_book_title(value: str) -> str:
    for suffix in (".fb2.zip", ".epub", ".fb2", ".pdf", ".txt", ".zip"):
        if value.lower().endswith(suffix):
            return value[: -len(suffix)]
    return value


def book_author(book: dict[str, Any]) -> str | None:
    value = book.get("author") or book.get("authors")
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, list):
        authors = [str(item).strip() for item in value if str(item).strip()]
        return ", ".join(authors) if authors else None
    return None


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
    return response.status == 403


def is_legacy_files_path(path: str) -> bool:
    return path.split("?", 1)[0].rstrip("/") == LEGACY_FILES_PATH.rstrip("/")


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
