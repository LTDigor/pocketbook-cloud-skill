import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


REPO_ROOT = Path(__file__).resolve().parents[1]
AUTH_SCRIPT = REPO_ROOT / "scripts" / "pocketbook_auth.py"
UPLOAD_SCRIPT = REPO_ROOT / "scripts" / "upload_ebook.py"
DELETE_SCRIPT = REPO_ROOT / "scripts" / "delete_ebook.py"


class PocketBookFakeHandler(BaseHTTPRequestHandler):
    requests = []

    def do_GET(self):
        parsed = urlparse(self.path)
        self.record(body="")
        if parsed.path == "/api/v1.0/auth/login":
            query = parse_qs(parsed.query)
            if query.get("username") != ["reader@example.test"]:
                self.send_json({"error": "bad username"}, status=400)
                return
            self.send_json({"providers": [{"alias": "pbook", "shop_id": 1, "name": "PocketBook"}]})
            return
        if parsed.path == "/api/v1.0/user":
            if self.headers.get("authorization") != "Bearer access-login":
                self.send_json({"error_code": 222, "error": "Unknown token"}, status=403)
                return
            self.send_json({"user_id": 7, "email": "reader@example.test"})
            return
        self.send_json({"error": "not found"}, status=404)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", "0"))).decode()
        self.record(body=body)
        parsed = urlparse(self.path)
        if parsed.path == "/api/v1.0/auth/login/pbook":
            form = parse_qs(body)
            if form.get("password") != ["secret-password"]:
                self.send_json({"error": "bad password"}, status=403)
                return
            self.send_json(
                {
                    "access_token": "access-login",
                    "refresh_token": "refresh-login",
                    "token_type": "Bearer",
                    "expires_in": 7200,
                }
            )
            return
        if parsed.path == "/api/v1.0/auth/renew-token":
            form = parse_qs(body)
            if form.get("refresh_token") != ["refresh-login"]:
                self.send_json({"error": "bad refresh"}, status=403)
                return
            self.send_json(
                {
                    "access_token": "access-refresh",
                    "refresh_token": "refresh-rotated",
                    "token_type": "Bearer",
                    "expires_in": 7200,
                }
            )
            return
        if parsed.path == "/api/v1.1/fileops/delete/":
            if self.headers.get("authorization") not in {"Bearer access-login", "Bearer access-refresh"}:
                self.send_json({"error_code": 222, "error": "Unknown token"}, status=403)
                return
            query = parse_qs(parsed.query)
            self.send_json({"deleted": True, "fast_hash": query.get("fast_hash", [None])[0]})
            return
        self.send_json({"error": "not found"}, status=404)

    def do_PUT(self):
        body = self.rfile.read(int(self.headers.get("content-length", "0")))
        self.record(body=body.decode(errors="replace"))
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/v1.1/files/"):
            if self.headers.get("authorization") not in {"Bearer access-login", "Bearer access-refresh"}:
                self.send_json({"error_code": 222, "error": "Unknown token"}, status=403)
                return
            self.send_json(
                {
                    "id": len(self.requests),
                    "path": parsed.path.removeprefix("/api/v1.1/files"),
                    "name": Path(parsed.path).name,
                    "bytes": str(len(body)),
                    "mime_type": self.headers.get("content-type"),
                    "fast_hash": f"hash-{len(self.requests)}",
                    "signed_url": "https://example.test/download?access_token=secret",
                }
            )
            return
        self.send_json({"error": "not found"}, status=404)

    def log_message(self, _format, *_args):
        return

    def record(self, body):
        self.requests.append(
            {
                "method": self.command,
                "path": self.path,
                "authorization": self.headers.get("authorization"),
                "content_type": self.headers.get("content-type"),
                "body": body,
            }
        )

    def send_json(self, payload, status=200):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class PythonScriptTests(unittest.TestCase):
    def setUp(self):
        PocketBookFakeHandler.requests = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), PocketBookFakeHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        self.temp = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp.name)
        self.env_file = self.temp_path / "pocketbook.env"
        self.env_file.write_text(
            "\n".join(
                [
                    f"POCKETBOOK_BASE_URL={self.base_url}",
                    "POCKETBOOK_LOGIN=reader@example.test",
                    "POCKETBOOK_PASSWORD=secret-password",
                    "POCKETBOOK_WEB_CLIENT_ID=web-client-123",
                    "POCKETBOOK_WEB_CLIENT_SECRET=web-secret-123",
                    "",
                ]
            )
        )
        self.ebook = self.temp_path / "book.fb2"
        self.ebook.write_text("<FictionBook>test</FictionBook>")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def test_login_persists_tokens_without_printing_secret_values(self):
        result = self.run_script(AUTH_SCRIPT, ["login", "--env-file", str(self.env_file)])

        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], 200)
        self.assertTrue(payload["persisted"])
        self.assertTrue(payload["tokens"]["hasAccessToken"])
        self.assertNotIn("access-login", result.stdout)
        self.assertNotIn("refresh-login", result.stdout)
        saved = self.env_file.read_text()
        self.assertIn('POCKETBOOK_ACCESS_TOKEN="access-login"', saved)
        self.assertIn('POCKETBOOK_REFRESH_TOKEN="refresh-login"', saved)

    def test_upload_uses_saved_token_and_redacts_signed_urls(self):
        self.run_script(AUTH_SCRIPT, ["login", "--env-file", str(self.env_file)])
        result = self.run_script(UPLOAD_SCRIPT, ["--env-file", str(self.env_file), str(self.ebook)])

        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["remoteName"], "book.fb2")
        self.assertIsNotNone(payload["fastHash"])
        self.assertNotIn("access_token", result.stdout)
        upload_request = [request for request in PocketBookFakeHandler.requests if request["method"] == "PUT"][0]
        self.assertEqual(upload_request["authorization"], "Bearer access-login")
        self.assertEqual(upload_request["content_type"], "application/x-fictionbook+xml")

    def test_delete_uses_fast_hash(self):
        self.run_script(AUTH_SCRIPT, ["login", "--env-file", str(self.env_file)])
        result = self.run_script(DELETE_SCRIPT, ["--env-file", str(self.env_file), "--fast-hash", "hash-123"])

        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["fastHash"], "hash-123")
        delete_request = [request for request in PocketBookFakeHandler.requests if request["method"] == "POST"][-1]
        self.assertEqual(delete_request["path"], "/api/v1.1/fileops/delete/?fast_hash=hash-123")

    def run_script(self, script, args):
        env = {**os.environ, "POCKETBOOK_SKIP_LOCAL_ENV": "1"}
        return subprocess.run(
            [sys.executable, str(script), *args],
            cwd=REPO_ROOT,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
