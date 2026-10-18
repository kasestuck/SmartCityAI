"""Serve only the public frontend files from the repository root."""

import argparse
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

PUBLIC_PAGES = {"index.html", "styleguide.html"}
PUBLIC_DIRECTORIES = {"js", "css", "assets", "data"}


def _is_public(parts):
    return (len(parts) == 1 and parts[0] in PUBLIC_PAGES) or (
        len(parts) > 1 and parts[0] in PUBLIC_DIRECTORIES
    )


class FrontendRequestHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        """Apply the same allowlist to GET and HEAD, including symlink targets."""
        try:
            path = unquote(urlsplit(self.path).path, errors="strict")
            if path == "/":
                path = "/index.html"
            parts = path.removeprefix("/").split("/")
            if (
                not path.startswith("/")
                or any(character in path for character in "\\:\x00")
                or any(part in {"", ".", ".."} for part in parts)
                or not _is_public(parts)
            ):
                raise ValueError("Nonpublic path")
            root = Path(self.directory).resolve()
            target = root.joinpath(*parts).resolve(strict=True)
            if not _is_public(target.relative_to(root).parts) or not target.is_file():
                raise ValueError("Nonpublic file")
            source = target.open("rb")
        except (OSError, ValueError, RuntimeError):
            self.send_error(404, "File not found")
            return None

        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(target)))
        self.send_header("Content-Length", str(os.fstat(source.fileno()).st_size))
        self.end_headers()
        return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bind", default="127.0.0.1", help="Interface to bind (default: 127.0.0.1)"
    )
    parser.add_argument("--port", type=int, default=5173, help="Port to serve (default: 5173)")
    options = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    handler = partial(FrontendRequestHandler, directory=str(root))
    with ThreadingHTTPServer((options.bind, options.port), handler) as server:
        advertised_host = "localhost" if options.bind == "127.0.0.1" else options.bind
        print(f"Frontend: http://{advertised_host}:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
