"""Content helper for the site.

    python manage.py new post "My Title"      create a draft blog post
    python manage.py list                     list posts and their status
    python manage.py publish [slug]           mark a draft as published, rebuild
    python manage.py publish [slug] --push    ...and commit + push (deploys the site)
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import subprocess
import sys
from pathlib import Path

import build

ROOT = Path(__file__).parent

TEMPLATES = {
    "post": (
        "_posts",
        True,
        '---\ntitle: "{title}"\ndate: {date}\nsummary: ""\ndraft: true\n---\n\n'
        "Write your post here. Explain the question, what you tried, what you learned,\n"
        "and what someone else can reuse.\n\n"
        "Media: `![alt](/assets/images/file.jpg)` or an HTML `<video controls>` tag.\n"
        "Math works as `\\( x^2 \\)` or `$$ ... $$`.\n",
    ),
}


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def open_in_editor(path: Path) -> None:
    if sys.platform == "win32":
        os.startfile(path)  # type: ignore[attr-defined]
    else:
        subprocess.run(["xdg-open", str(path)], check=False)


def cmd_new(args: argparse.Namespace) -> None:
    folder, dated_name, template = TEMPLATES[args.kind]
    today = dt.date.today().isoformat()
    slug = slugify(args.title)
    if not slug:
        sys.exit("Title must contain letters or digits.")
    path = ROOT / folder / (f"{today}-{slug}.md" if dated_name else f"{slug}.md")
    if path.exists():
        sys.exit(f"{path.name} already exists.")
    path.parent.mkdir(exist_ok=True)
    path.write_text(template.format(title=args.title.replace('"', "'"), date=today), encoding="utf-8")
    print(f"Created {path.relative_to(ROOT)}")
    if args.kind == "post":
        print("It is a draft: preview with `python serve.py`, publish with `python manage.py publish`.")
    if not args.no_open:
        open_in_editor(path)


def draft_posts() -> list[Path]:
    return [
        p for p in sorted((ROOT / "_posts").glob("*.md"))
        if re.search(r"^draft:\s*true\s*$", p.read_text(encoding="utf-8"), re.M)
    ]


def cmd_list(_: argparse.Namespace) -> None:
    for path in sorted((ROOT / "_posts").glob("*.md"), reverse=True):
        status = "draft    " if path in draft_posts() else "published"
        print(f"{status}  {path.name}")


def cmd_publish(args: argparse.Namespace) -> None:
    drafts = draft_posts()
    if args.slug:
        drafts = [p for p in drafts if args.slug in p.stem]
    if not drafts:
        sys.exit("No matching drafts. Run `python manage.py list` to see posts.")
    if len(drafts) > 1:
        names = "\n  ".join(p.name for p in drafts)
        sys.exit(f"Several drafts match; pass a slug to choose one:\n  {names}")

    path = drafts[0]
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"^draft:\s*true\s*$", "draft: false", text, count=1, flags=re.M)
    path.write_text(text, encoding="utf-8")
    print(f"Published {path.name}")

    counts = build.build(ROOT / "dist")
    print(f"Rebuilt site ({counts['posts']} posts).")

    if args.push:
        if not (ROOT / ".git").exists():
            sys.exit("Not a git repository; commit and push the site manually.")
        subprocess.run(["git", "add", "-A"], cwd=ROOT, check=True)
        subprocess.run(["git", "commit", "-m", f"Publish {path.stem}"], cwd=ROOT, check=True)
        subprocess.run(["git", "push"], cwd=ROOT, check=True)
        print("Pushed; GitHub Actions will deploy the site.")
    else:
        print("Commit and push (or rerun with --push) to deploy.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    new = sub.add_parser("new", help="create a new content file")
    new.add_argument("kind", choices=sorted(TEMPLATES))
    new.add_argument("title")
    new.add_argument("--no-open", action="store_true", help="do not open the file in an editor")
    new.set_defaults(func=cmd_new)

    sub.add_parser("list", help="list blog posts").set_defaults(func=cmd_list)

    publish = sub.add_parser("publish", help="publish a draft post")
    publish.add_argument("slug", nargs="?", help="part of the post filename")
    publish.add_argument("--push", action="store_true", help="git add, commit and push")
    publish.set_defaults(func=cmd_publish)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
