"""Render the final NG frame to _includes/ng.svg (the no-JS / reduced-motion hero).

    pip install playwright   (once; uses your installed Edge or Chrome)
    python tools/make_ng_svg.py

Run it again whenever assets/js/optics/ng.js or ng-draw.js changes. The browser runs the real
tracer and painter, so the static frame cannot drift from the live canvas.
"""
from __future__ import annotations

import functools
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_includes" / "ng.svg"

SCRIPT = """
async () => {
  const ng = await import('/assets/js/optics/ng.js');
  const draw = await import('/assets/js/optics/ng-draw.js');
  const scene = ng.buildScene();
  const segments = ng.traceScene(scene);
  return draw.sceneToSvg(scene, segments, ng.litDetectors(scene, segments), ng.VIEW);
}
"""


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass


def launch(p):
    for channel in ("msedge", "chrome", None):
        try:
            return p.chromium.launch(channel=channel) if channel else p.chromium.launch()
        except Exception:
            continue
    raise SystemExit("No Chromium-based browser found.")


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page()
        page.goto(f"http://127.0.0.1:{server.server_address[1]}/README.md")
        svg = page.evaluate(SCRIPT)
        browser.close()
    OUT.write_text(svg + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(svg)} bytes)")


if __name__ == "__main__":
    main()
