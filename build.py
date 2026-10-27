"""Static site generator for nirbhik-cell.github.io.

Usage:
    python build.py [--out DIR] [--drafts]

Content: blog posts are Markdown files with front matter in _posts/. Everything else (CV,
timeline, research rows, contact links) comes from _data/cv.yml; publications, projects and the
extra Career/Life timeline tracks have their own files (publications.yml, projects.yml, timeline.yml).
Templates are in layouts/. Set SITE_URL / BASE_URL in the environment to build for a
custom domain or a repo sub-path (e.g. BASE_URL=/my-repo).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import os
import re
import shutil
import time
from pathlib import Path
from typing import Any

import frontmatter
import markdown
import pypdfium2 as pdfium
import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape
from pygments.formatters import HtmlFormatter


ROOT = Path(__file__).parent
DATA_DIR = ROOT / "_data"
LAYOUT_DIR = ROOT / "layouts"
INCLUDE_DIR = ROOT / "_includes"
ASSETS_DIR = ROOT / "assets"
CSS_DIR = ASSETS_DIR / "css"

CV_PDF = "/assets/files/Nirbhik_Gupta_CV.pdf"

SITE: dict[str, Any] = {
    "title": "Nirbhik Gupta",
    "initials": "NG",
    "description": "Nirbhik Gupta: physics student at IISER Mohali, research intern in nonlinear photonics at IIT Bombay.",
    "url": os.environ.get("SITE_URL", "https://nirbhik-cell.github.io").rstrip("/"),
    "baseurl": os.environ.get("BASE_URL", "").rstrip("/"),
    "footer_line": "Light travels 299,792,458 m/s. This page tried its best.",
    "nav": [
        {"key": "projects", "label": "Projects & Publications", "url": "/projects/"},
        {"key": "blog", "label": "Blog", "url": "/blog/"},
        {"key": "cv", "label": "CV", "url": "/cv/"},
        {"key": "contact", "label": "Contact", "url": "/contact/"},
    ],
}

# Old URLs that now live elsewhere: path -> target.
REDIRECTS = {
    "/about/": "/#about",
    "/resume/": "/cv/",
    "/publications/": "/projects/",
    "/software/": "/projects/",
    "/lab/": "/",
    "/timeline/": "/#timeline",
}

MARKDOWN_EXTENSIONS = [
    "fenced_code",
    "codehilite",
    "tables",
    "footnotes",
    "toc",
    "attr_list",
    "md_in_html",
    "sane_lists",
    "pymdownx.arithmatex",
]
MARKDOWN_CONFIG = {
    "codehilite": {"css_class": "codehilite", "guess_lang": False},
    "toc": {"permalink": "#", "permalink_title": "Link to this section", "toc_depth": "2-3"},
    "pymdownx.arithmatex": {"generic": True},
}

DATE_PREFIX = re.compile(r"^(\d{4})-(\d{2})-(\d{2})-(.+)$")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
OPEN_ENDED = {"ongoing", "present"}

LIGHT_CODE_FIXES = [
    (["c", "ch", "cm", "c1", "cs", "cp", "cpf", "sd"], "#4a5a52"),
    (["nn", "nc", "ne", "nl", "ni", "nd", "bp", "nv", "vc", "vg", "vi", "fm"], "#0a5d87"),
    (["s", "sa", "sb", "sc", "s2", "se", "sh", "si", "sx", "sr", "s1", "ss", "dl"], "#2c5a85"),
    (["m", "mb", "mf", "mh", "mi", "mo", "il"], "#1f6b47"),
    (["nt", "na", "no", "vm"], "#0a5d87"),
]

# Timeline tracks, left to right: key, label, one-line blurb.
TRACKS = [
    ("education", "Education", "Degrees and courses"),
    ("research", "Research", "Labs and advisors"),
    ("career", "Career", "Jobs and roles"),
    ("life", "Life", "Off the clock"),
]

Entry = dict[str, Any]


# --------------------------------------------------------------------------
# Content loading
# --------------------------------------------------------------------------

def load_data() -> dict[str, Any]:
    data = {}
    for path in sorted(DATA_DIR.glob("*.yml")):
        try:
            data[path.stem] = yaml.safe_load(path.read_text(encoding="utf-8"))
        except yaml.YAMLError as error:
            mark = getattr(error, "problem_mark", None)
            where = f" (line {mark.line + 1}, column {mark.column + 1})" if mark else ""
            hint = " Tip: put quotes around any text that contains a colon followed by a space." if "mapping values" in str(error) else ""
            raise SystemExit(f"_data/{path.name}: not valid YAML{where}.{hint}") from None
    return data


def render_markdown(text: str) -> tuple[str, list[dict[str, Any]]]:
    """Render Markdown to (html, toc_tokens)."""
    md = markdown.Markdown(extensions=MARKDOWN_EXTENSIONS, extension_configs=MARKDOWN_CONFIG)
    text = re.sub(r"^\[\[demo:[a-z-]+\]\]\s*$", "", text, flags=re.M)  # demos were removed; drop old shortcodes
    out = md.convert(text)
    out = re.sub(r'(<a class="headerlink" href="#[^"]+")', r"\1 aria-label=\"Link to this section\"", out)
    return out, getattr(md, "toc_tokens", [])


def toc_html(tokens: list[dict[str, Any]]) -> str:
    def walk(items: list[dict[str, Any]]) -> str:
        rows = []
        for item in items:
            children = walk(item["children"]) if item.get("children") else ""
            rows.append(f'<li><a href="#{item["id"]}">{html.escape(item["name"])}</a>{children}</li>')
        return "<ol>" + "".join(rows) + "</ol>" if rows else ""

    return walk(tokens)


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def to_date(value: Any, fallback: dt.date) -> dt.date:
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    if isinstance(value, str):
        return dt.date.fromisoformat(value[:10])
    return fallback


def strip_tags(markup: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", markup)).strip()


def make_excerpt(meta: dict[str, Any], body_html: str, limit: int = 180) -> str:
    if meta.get("summary"):
        return str(meta["summary"])
    match = re.search(r"<p>(.*?)</p>", body_html, re.S)
    text = re.sub(r"\s+", " ", strip_tags(match.group(1))) if match else ""
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def load_posts(directory: Path, *, drafts: bool = False) -> list[Entry]:
    """Load every Markdown file in directory as a blog post, newest first."""
    entries: list[Entry] = []
    today = dt.date.today()
    for path in sorted(directory.glob("*.md")):
        post = frontmatter.load(path)
        meta = dict(post.metadata)
        prefix = DATE_PREFIX.match(path.stem)
        slug = prefix.group(4) if prefix else path.stem
        filename_date = (
            dt.date(int(prefix.group(1)), int(prefix.group(2)), int(prefix.group(3)))
            if prefix
            else dt.date.fromtimestamp(path.stat().st_mtime)
        )
        date = to_date(meta.get("date"), filename_date)
        is_draft = bool(meta.get("draft", False))
        if not drafts and (is_draft or date > today):
            continue

        body_html, toc_tokens = render_markdown(post.content)
        words = len(strip_tags(body_html).split())
        h2_count = len([t for t in toc_tokens if t.get("level") == 2])
        entries.append(
            {
                **meta,
                "slug": slug,
                "url": f"/blog/{date:%Y}/{date:%m}/{date:%d}/{slug}/",
                "date": date,
                "updated": to_date(meta.get("updated"), date) if meta.get("updated") else None,
                "draft": is_draft,
                "html": body_html,
                "excerpt": make_excerpt(meta, body_html),
                "reading_time": max(1, round(words / 220)),
                "math": "arithmatex" in body_html,
                "toc": toc_html(toc_tokens) if h2_count >= 3 else "",
            }
        )
    entries.sort(key=lambda e: (e["date"], e["title"]), reverse=True)
    return entries


# --------------------------------------------------------------------------
# CV: the single data source for /cv/, the PDF, the timeline, About and Research rows
# --------------------------------------------------------------------------

def parse_when(value: Any) -> tuple[int, int] | None:
    """'2024' -> (2024, 0); '2024-06' -> (2024, 6); anything else -> None."""
    match = re.match(r"^\s*(\d{4})(?:-(\d{2}))?\s*$", str(value)) if value not in (None, "") else None
    return (int(match.group(1)), int(match.group(2) or 0)) if match else None


def format_when(value: Any) -> str:
    parsed = parse_when(value)
    if not parsed:
        return str(value or "")
    year, month = parsed
    return f"{MONTHS[month - 1]} {year}" if month else str(year)


def period_label(item: dict[str, Any]) -> str:
    start = format_when(item["start"])
    end = str(item.get("end", "")).strip()
    if end.lower() in OPEN_ENDED:
        return f"{start} – present"
    return f"{start} – {format_when(end)}" if end and end != str(item["start"]) else start


def validate_cv(cv: dict[str, Any]) -> None:
    """Fail the build with a clear message when the _data files are malformed."""
    files = {"career": "timeline.yml", "life": "timeline.yml", "publication": "publications.yml", "project": "projects.yml"}

    def need(condition: bool, message: str) -> None:
        if not condition:
            file = next((f for key, f in files.items() if message.startswith(key)), "cv.yml")
            raise SystemExit(f"_data/{file}: {message}")

    for key in ("name", "initials", "headline", "intro"):
        need(bool(cv.get(key)), f"missing '{key}'")
    contact = cv.get("contact") or {}
    for key in ("email", "linkedin", "github"):
        need(bool(contact.get(key)), f"missing contact.{key}")
    for section in ("education", "experience"):
        for item in cv.get(section) or []:
            label = item.get("degree") or item.get("role") or "?"
            need(parse_when(item.get("start")) is not None, f"{section} '{label}': 'start' must be YYYY or YYYY-MM")
            end = str(item.get("end", ""))
            need(
                end.lower() in OPEN_ENDED or parse_when(end) is not None,
                f"{section} '{label}': 'end' must be YYYY, YYYY-MM, 'present' or 'ongoing'",
            )
    for track in ("career", "life"):
        for item in cv.get(track) or []:
            need(parse_when(item.get("start")) is not None and bool(item.get("title")), f"{track}: each entry needs a title and a start (YYYY or YYYY-MM)")
    for kind in ("publication", "project"):
        for item in cv.get(f"{kind}s") or []:
            need(all(item.get(k) for k in ("year", "title")), f"{kind}: each entry needs 'year' and 'title'")
            for link in item.get("links") or []:
                need(bool(link.get("label")) and bool(link.get("url")), f"{kind} '{item.get('title')}': each entry in links needs a label and a url")


def prepare_cv(cv: dict[str, Any]) -> dict[str, Any]:
    """Add display fields: period labels, timeline entries, and newest-first lists."""
    validate_cv(cv)
    education = [{**e, "period": period_label(e)} for e in cv.get("education") or []]
    experience = [{**e, "period": period_label(e)} for e in cv.get("experience") or []]
    by_start = lambda e: parse_when(e["start"])  # noqa: E731

    # Timeline: one row per entry, oldest first. Research stints fork the beam.
    timeline = [
        {
            "id": slugify(f"{e['start']}-{e['degree']}"),
            "sort": parse_when(e["start"]),
            "track": "education",
            "year": str(parse_when(e["start"])[0]),
            "period": e["period"],
            "title": e["degree"],
            "place": e["institution"],
            "note": e.get("note"),
            "bullets": [],
            "coursework": e.get("coursework") or [],
            "link": None,
        }
        for e in education
    ] + [
        {
            "id": slugify(f"{e['start']}-{e['role']}-{e['institution']}"),
            "sort": parse_when(e["start"]),
            "track": "research",
            "year": str(parse_when(e["start"])[0]),
            "period": e["period"],
            "title": e["role"],
            "place": ", ".join(p for p in (e.get("lab"), e["institution"]) if p),
            "note": f"Advisor: {e['advisor']}" if e.get("advisor") else None,
            "description": e.get("lab_description"),
            "bullets": e.get("bullets") or [],
            "coursework": [],
            "link": e.get("link"),
        }
        for e in experience
    ]
    for track in ("career", "life"):
        for e in cv.get(track) or []:
            timeline.append(
                {
                    "id": slugify(f"{e['start']}-{e['title']}"),
                    "sort": parse_when(e["start"]),
                    "track": track,
                    "year": str(parse_when(e["start"])[0]),
                    "period": period_label(e) if e.get("end") else format_when(e["start"]),
                    "title": e["title"],
                    "place": e.get("place") or "",
                    "note": e.get("note"),
                    "bullets": [],
                    "coursework": [],
                    "link": e.get("link"),
                }
            )
    timeline.sort(key=lambda t: t["sort"])

    # Entries that start in the same month share a grid row, so tracks line up across columns.
    # Row 1 holds the track labels.
    rank = {when: i + 2 for i, when in enumerate(sorted({t["sort"] for t in timeline}))}
    for t in timeline:
        t["row"] = rank[t["sort"]]
    tracks = []
    for col, (key, label, blurb) in enumerate(TRACKS, start=1):
        entries = [{**t, "col": col, "track_label": label} for t in timeline if t["track"] == key]
        tracks.append({"key": key, "label": label, "blurb": blurb, "col": col, "entries": entries})
    timeline = [e for t in tracks for e in t["entries"]]
    now_row = max(rank.values(), default=2) + 1
    return {
        **cv,
        "education": sorted(education, key=by_start, reverse=True),
        "experience": sorted(experience, key=by_start, reverse=True),
        "timeline": timeline,
        "tracks": tracks,
        "now_row": now_row,
        "publications": sorted(cv.get("publications") or [], key=lambda p: str(p["year"]), reverse=True),
        "projects": sorted(cv.get("projects") or [], key=lambda p: str(p["year"]), reverse=True),
    }


def render_cv_pages(pdf: Path, out_dir: Path) -> tuple[list[dict[str, Any]], str]:
    """Render each page of the CV PDF to a PNG (shown on /cv/, themed with CSS) and pull out its text."""
    if not pdf.exists():
        raise SystemExit(f"{pdf.relative_to(ROOT)} is missing: put your CV PDF there.")
    out_dir.mkdir(parents=True, exist_ok=True)
    # The PDF's hash goes in the file name, so a new CV is never shown from a cached old image.
    stamp = hashlib.md5(pdf.read_bytes()).hexdigest()[:8]
    document = pdfium.PdfDocument(str(pdf))
    pages, texts = [], []
    for index in range(len(document)):
        page = document[index]
        image = page.render(scale=2).to_pil()
        name = f"page-{index + 1}-{stamp}.png"
        image.save(out_dir / name, optimize=True)
        pages.append({"src": f"/assets/cv/{name}", "width": image.width, "height": image.height, "number": index + 1})
        texts.append(page.get_textpage().get_text_range())
    text = "\n\n".join(t.replace("\r", "").strip() for t in texts)
    # Keep addresses out of the HTML as plain text, like everywhere else on the site.
    text = re.sub(r"([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)", lambda m: f"{m[1]} [at] {m[2].replace('.', ' [dot] ')}", text)
    return pages, text


def social_links(cv: dict[str, Any], order: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Contact links: order and icons from socials.yml, values from cv.yml."""
    contact = cv["contact"]
    links = []
    for item in order:
        value = contact.get(item["key"])
        if not value:
            continue
        link = {"label": item["label"], "icon": item["icon"]}
        if item["key"] == "phone":
            link["phone"] = value
            links.append(link)
            continue
        link["email" if item["key"].startswith("email") else "url"] = value
        links.append(link)
    return links


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def make_env() -> Environment:
    env = Environment(
        loader=FileSystemLoader([LAYOUT_DIR, INCLUDE_DIR]),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    baseurl = SITE["baseurl"]
    env.filters["url"] = lambda path: f"{baseurl}{path}"
    env.filters["absurl"] = lambda path: f"{SITE['url']}{baseurl}{path}"
    env.filters["fmt_date"] = lambda d: f"{d:%b} {d.day}, {d.year}"
    env.filters["iso"] = lambda d: d.isoformat()
    env.filters["reverse_str"] = lambda s: str(s)[::-1]
    env.filters["spam_safe"] = lambda s: str(s).replace("@", " [at] ").replace(".", " [dot] ")
    env.filters["spam_safe_phone"] = lambda s: "available with JavaScript enabled"
    env.filters["host"] = lambda s: re.sub(r"^https?://(www\.)?", "", str(s)).rstrip("/")
    return env


def write_file(out: Path, relative: str, content: str) -> None:
    target = out / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def write_page(out: Path, url: str, content: str) -> None:
    """Write content to the directory-style path for url (/cv/ -> cv/index.html)."""
    write_file(out, f"{url.strip('/')}/index.html".lstrip("/"), content)


def build_css(out: Path) -> None:
    dark = HtmlFormatter(style="monokai").get_style_defs(':root:not([data-theme="light"]) .codehilite')
    light = HtmlFormatter(style="friendly").get_style_defs(':root[data-theme="light"] .codehilite')
    # System-light visitors who never touched the toggle also get the light palette.
    system_light = HtmlFormatter(style="friendly").get_style_defs(
        ':root:not([data-theme="dark"]):not([data-theme="light"]) .codehilite'
    )

    # Pygments' "friendly" colours are too pale on the paper background; darken the failing ones to >= 4.5:1.
    def fixes(scope: str) -> str:
        return "".join(
            ", ".join(f"{scope} .codehilite .{t}" for t in tokens) + f" {{ color: {color}; }}\n"
            for tokens, color in LIGHT_CODE_FIXES
        )

    system_scope = ':root:not([data-theme="dark"]):not([data-theme="light"])'
    parts = [path.read_text(encoding="utf-8") for path in sorted(CSS_DIR.glob("[0-9]*.css"))]
    css = "\n".join(
        [dark, light, fixes(':root[data-theme="light"]'), "@media (prefers-color-scheme: light) {", system_light, fixes(system_scope), "}", *parts]
    )
    write_file(out, "assets/css/main.css", css)


def copy_assets(out: Path) -> None:
    shutil.copytree(ASSETS_DIR, out / "assets", dirs_exist_ok=True, ignore=shutil.ignore_patterns("css", ".gitkeep"))


def build(out: Path, *, drafts: bool = False, dev: bool = False) -> dict[str, int]:
    """Build the whole site into out. Returns page counts for reporting."""
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    site = {**SITE, "build_time": time.strftime("%Y%m%d%H%M%S"), "dev": dev, "cv_pdf": CV_PDF, "year": dt.date.today().year}
    data = load_data()
    env = make_env()
    timeline_data = data.get("timeline") or {}
    cv = prepare_cv(
        {
            **data["cv"],
            "publications": data.get("publications") or [],
            "projects": data.get("projects") or [],
            "career": timeline_data.get("career") or [],
            "life": timeline_data.get("life") or [],
        }
    )
    posts = load_posts(ROOT / "_posts", drafts=drafts)
    socials = social_links(cv, data.get("socials") or [])
    site["description"] = f"{cv['name']}: {cv['headline'].rstrip('.')}. {cv['intro'].split('.')[0].strip()}."

    common = {"site": site, "cv": cv, "posts": posts, "socials": socials}
    urls: list[str] = []

    def render(template: str, url: str, **context: Any) -> None:
        context["page"] = {"url": url, **context.get("page", {})}
        write_page(out, url, env.get_template(template).render(**common, **context))
        urls.append(url)

    copy_assets(out)
    build_css(out)
    cv_pages, cv_text = render_cv_pages(ASSETS_DIR / "files" / Path(CV_PDF).name, out / "assets" / "cv")

    render("home.html", "/", page={"title": "Home", "nav": "home"}, latest_posts=posts[:3])
    render(
        "projects.html",
        "/projects/",
        page={"title": "Projects & Publications", "nav": "projects", "description": "Research, projects and publications."},
    )
    render(
        "blog.html",
        "/blog/",
        page={"title": "Blog", "nav": "blog", "description": "Notes and writing."},
    )
    for index, post in enumerate(posts):
        render(
            "post.html",
            post["url"],
            page={"title": post["title"], "nav": "blog", "description": post["excerpt"], "type": "article"},
            post=post,
            newer=posts[index - 1] if index > 0 else None,
            older=posts[index + 1] if index + 1 < len(posts) else None,
        )
    render(
        "cv.html",
        "/cv/",
        page={"title": "CV", "nav": "cv", "description": f"Curriculum vitae of {cv['name']}: education, research experience and skills."},
        cv_pages=cv_pages,
        cv_text=cv_text,
    )
    render(
        "contact.html",
        "/contact/",
        page={"title": "Contact", "nav": "contact", "description": f"Email and links for {cv['name']}."},
    )

    # Pages that are not part of the sitemap.
    for old, target in REDIRECTS.items():
        write_page(out, old, env.get_template("redirect.html").render(**common, page={"title": "Moved"}, target=target))
    write_file(
        out,
        "404.html",
        env.get_template("404.html").render(**common, page={"title": "Beam lost", "url": "/404.html", "nav": "", "noindex": True}),
    )
    write_file(out, "sitemap.xml", env.get_template("sitemap.xml").render(**common, urls=urls))
    write_file(out, "robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {SITE['url']}{SITE['baseurl']}/sitemap.xml\n")

    return {
        "pages": len(urls),
        "posts": len(posts),
        "timeline entries": len(cv["timeline"]),
        "publications": len(cv["publications"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "dist")
    parser.add_argument("--drafts", action="store_true", help="include drafts and future-dated posts")
    args = parser.parse_args()
    counts = build(args.out, drafts=args.drafts)
    summary = ", ".join(f"{n} {name}" for name, n in counts.items())
    print(f"Built {args.out} ({summary})")


if __name__ == "__main__":
    main()
