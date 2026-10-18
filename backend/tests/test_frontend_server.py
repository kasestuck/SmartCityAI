import subprocess
import sys
from contextlib import contextmanager
from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from queue import Queue
from threading import Thread
from urllib.parse import urlsplit

import pytest


@pytest.fixture
def site_root(tmp_path):
    root = tmp_path / "site"
    files = {
        "index.html": "front page",
        "styleguide.html": "style guide",
        "js/main.js": "console.log('public');",
        "css/main.css": "body { color: blue; }",
        "assets/icon.svg": "<svg></svg>",
        "data/places.json": '{"places": []}',
        "backend/.env": "secret-key",
        "backend/data/poi.sqlite3": "private-database",
        ".git/config": "private-git-config",
        "README.md": "private-readme",
    }
    for name, content in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return root


@contextmanager
def frontend_server(root):
    from tools.serve_frontend import FrontendRequestHandler

    handler = partial(FrontendRequestHandler, directory=str(root))
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        try:
            yield server.server_address
        finally:
            server.shutdown()
            thread.join(timeout=5)


def request(address, path, method="GET"):
    connection = HTTPConnection(*address, timeout=5)
    try:
        connection.request(method, path)
        response = connection.getresponse()
        return response.status, response.read(), response.getheader("Content-Length")
    finally:
        connection.close()


@pytest.mark.parametrize("method", ["GET", "HEAD"])
@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/", b"front page"),
        ("/index.html", b"front page"),
        ("/styleguide.html", b"style guide"),
        ("/js/main.js", b"console.log('public');"),
        ("/css/main.css?v=1", b"body { color: blue; }"),
        ("/assets/icon.svg", b"<svg></svg>"),
        ("/data/places.json", b'{"places": []}'),
    ],
)
def test_serves_public_frontend_files(site_root, path, expected, method):
    with frontend_server(site_root) as address:
        status, body, length = request(address, path, method)
    assert status == 200
    assert body == (expected if method == "GET" else b"")
    assert length == str(len(expected))


@pytest.mark.parametrize("method", ["GET", "HEAD"])
@pytest.mark.parametrize(
    "path",
    [
        "/backend/.env",
        "/backend/data/poi.sqlite3",
        "/.git/config",
        "/README.md",
        "/missing.html",
        "/js/missing.js",
        "/js/../backend/.env",
        "/js/%2e%2e/backend/.env",
        "/js/%2e%2e%2fbackend/.env",
        "/%62ackend/.env",
        "/js/%252e%252e/backend/.env",
        "/js/..%5cbackend/.env",
        "/js/main.js%00",
        "/index.html::$DATA",
        "/js",
        "/js/",
        "/css/",
        "/assets/",
        "/data/",
    ],
)
def test_denies_private_paths_traversal_and_directory_listings(site_root, path, method):
    with frontend_server(site_root) as address:
        status, body, _ = request(address, path, method)
    assert status == 404
    assert b"secret-key" not in body
    assert b"private-" not in body
    assert b"Directory listing" not in body
    if method == "HEAD":
        assert body == b""


@pytest.mark.parametrize("method", ["GET", "HEAD"])
@pytest.mark.parametrize(
    "target_kind", ["private_file", "private_directory", "outside_file", "page"]
)
def test_denies_symlinks_to_nonpublic_files(site_root, target_kind, method):
    outside = site_root.parent / "outside.txt"
    outside.write_text("outside-secret", encoding="utf-8")
    if target_kind == "private_directory":
        link = site_root / "assets" / "private"
        target = site_root / "backend"
        url = "/assets/private/.env"
    elif target_kind == "page":
        link = site_root / "index.html"
        link.unlink()
        target = site_root / "backend" / ".env"
        url = "/"
    else:
        link = site_root / "js" / "linked.js"
        target = outside if target_kind == "outside_file" else site_root / "backend" / ".env"
        url = "/js/linked.js"
    try:
        link.symlink_to(target, target_is_directory=target.is_dir())
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"Symlinks are unavailable: {exc}")
    with frontend_server(site_root) as address:
        status, body, _ = request(address, url, method)
    assert status == 404
    assert b"secret" not in body


def test_cli_advertises_localhost_to_match_default_cors_origin(tmp_path):
    script = Path(__file__).resolve().parents[2] / "tools" / "serve_frontend.py"
    process = subprocess.Popen(
        [sys.executable, str(script), "--port", "0"],
        cwd=tmp_path,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    lines = Queue()
    reader = Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True)
    reader.start()
    try:
        banner = lines.get(timeout=5).strip()
        assert banner.startswith("Frontend: ")
        advertised = urlsplit(banner.removeprefix("Frontend: "))
        assert advertised.hostname == "localhost"
        assert advertised.port > 0
        status, _, _ = request(("127.0.0.1", advertised.port), "/")
        assert status == 200
    finally:
        process.terminate()
        process.communicate(timeout=5)
        reader.join(timeout=5)
