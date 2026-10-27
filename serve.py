"""Dev server: rebuilds on file changes (drafts included) and live-reloads the browser.

Usage: python serve.py [--port 4000]
"""
from __future__ import annotations

import argparse
import functools
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import build

ROOT = Path(__file__).parent
OUT = ROOT / "dist"
WATCHED = ["_data", "_posts", "layouts", "_includes", "assets"]
WATCHED_FILES = ["build.py"]

version = str(time.time())


def snapshot() -> float:
    newest = 0.0
    paths = [ROOT / name for name in WATCHED_FILES]
    for name in WATCHED:
        paths.extend(p for p in (ROOT / name).rglob("*") if p.is_file())
    for path in paths:
        try:
            newest = max(newest, path.stat().st_mtime)
        except OSError:
            pass
    return newest


def rebuild() -> None:
    global version
    try:
        counts = build.build(OUT, drafts=True, dev=True)
        version = str(time.time())
        print(f"Rebuilt ({counts['pages']} pages)")
    except Exception as error:  # keep serving the last good build
        print(f"Build failed: {error}")


def watch() -> None:
    seen = snapshot()
    while True:
        time.sleep(0.7)
        current = snapshot()
        if current != seen:
            seen = current
            rebuild()


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/__version":
            body = version.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def send_head(self):  # serve 404.html for unknown paths, like GitHub Pages
        translated = Path(self.translate_path(self.path))
        if not translated.exists() and not self.path.startswith("/__"):
            self.path = "/404.html"
        return super().send_head()

    def log_message(self, format: str, *args) -> None:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4000)
    args = parser.parse_args()

    rebuild()
    threading.Thread(target=watch, daemon=True).start()
    handler = functools.partial(Handler, directory=str(OUT))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"Serving http://localhost:{args.port}  (drafts visible, Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
