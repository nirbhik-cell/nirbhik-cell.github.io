"""Check internal links and asset references in dist/.   python tools/check_links.py"""
import os, re, sys
from pathlib import Path
from urllib.parse import urldefrag, urlparse

dist = Path(__file__).resolve().parent.parent / "dist"
base = os.environ.get("BASE_URL", "").rstrip("/")  # site subpath, e.g. /nirbhik-gupta
bad = []
ids_cache = {}

def ids(p):
    if p not in ids_cache:
        ids_cache[p] = set(re.findall(r'\bid="([^"]+)"', p.read_text(encoding="utf-8", errors="ignore")))
    return ids_cache[p]

for page in dist.rglob("*.html"):
    html = page.read_text(encoding="utf-8")
    for attr, ref in re.findall(r'\b(href|src)="([^"]+)"', html):
        if ref.startswith(("http:", "https:", "mailto:", "data:", "javascript:", "#")) and not ref.startswith("#"):
            continue
        url, frag = urldefrag(ref)
        if ref.startswith("#"):
            target = page
        else:
            path = urlparse(url).path
            if base and (path == base or path.startswith(base + "/")):
                path = path[len(base):] or "/"
            if not path.startswith("/"):
                path = "/" + str(page.parent.relative_to(dist)).replace("\\", "/") + "/" + path
            t = dist / path.lstrip("/")
            target = t / "index.html" if t.is_dir() else t
        if not target.exists():
            bad.append(f"{page.relative_to(dist)}: {ref} -> missing")
        elif frag and target.suffix == ".html" and frag not in ids(target):
            bad.append(f"{page.relative_to(dist)}: {ref} -> no id #{frag}")
print("\n".join(sorted(set(bad))) or "No broken internal links.")
sys.exit(1 if bad else 0)
