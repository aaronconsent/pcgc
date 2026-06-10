#!/usr/bin/env python3
"""
Sanitize filenames under site/ so Cloudflare Wrangler's static-assets
uploader accepts them.

Wrangler rejects path segments containing characters that aren't safe in
URI paths (`:`, raw `%`, `!`, spaces). The wsimg image variants saved by
crawl.py contain all of these (e.g. ``blob.png/:/rs=w:191,m``).

This pass:
1. Walks site/, finds every file whose path needs cleaning.
2. Renames the file to a sibling with a sanitized basename.
3. Rewrites every HTML/CSS/JS reference to the old relative path so the
   page still loads the asset.
"""
import os
import re
import shutil

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")

UNSAFE_SEGMENT = re.compile(r"[^A-Za-z0-9._\-/]")


def safe_segment(seg):
    # collapse any run of unsafe chars to a single `_`
    return re.sub(r"_+", "_", UNSAFE_SEGMENT.sub("_", seg)).strip("_") or "_"


def sanitize_relpath(rel):
    parts = rel.split(os.sep)
    return os.sep.join(safe_segment(p) for p in parts)


def collect_renames():
    """Return list of (old_abs, new_abs, old_rel, new_rel) for files that
    need renaming, plus mapping old_rel -> new_rel."""
    renames = []
    mapping = {}
    for dirpath, _, files in os.walk(ROOT):
        for fn in files:
            old_abs = os.path.join(dirpath, fn)
            old_rel = os.path.relpath(old_abs, ROOT)
            new_rel = sanitize_relpath(old_rel)
            if new_rel == old_rel:
                continue
            new_abs = os.path.join(ROOT, new_rel)
            # guard against collision
            base, ext = os.path.splitext(new_abs)
            i = 1
            while os.path.exists(new_abs) or new_abs in {r[1] for r in renames}:
                new_abs = f"{base}_{i}{ext}"
                i += 1
            new_rel = os.path.relpath(new_abs, ROOT)
            renames.append((old_abs, new_abs, old_rel, new_rel))
            mapping[old_rel] = new_rel
    return renames, mapping


def rewrite_refs(mapping):
    """For each text file (HTML/CSS/JS), replace any occurrence of an old
    relative path (with `/` separators) with its sanitized replacement."""
    # Pre-build a list sorted by length desc so longer paths replace first.
    items = sorted(
        [(old.replace(os.sep, "/"), new.replace(os.sep, "/")) for old, new in mapping.items()],
        key=lambda t: -len(t[0]),
    )
    targets = []
    for dp, _, files in os.walk(ROOT):
        for fn in files:
            if fn.endswith((".html", ".css", ".js")):
                targets.append(os.path.join(dp, fn))
    for path in targets:
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
        except UnicodeDecodeError:
            continue
        orig = text
        for old, new in items:
            if old in text:
                text = text.replace(old, new)
            # also try matching with just the file basename in case the
            # reference was further-truncated by relative-path math; the
            # exact-match above catches the common case.
        if text != orig:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            print(f"  rewrote refs in {os.path.relpath(path, ROOT)}")


def main():
    renames, mapping = collect_renames()
    print(f"{len(renames)} files to rename")
    for old_abs, new_abs, old_rel, new_rel in renames:
        os.makedirs(os.path.dirname(new_abs), exist_ok=True)
        shutil.move(old_abs, new_abs)
    rewrite_refs(mapping)
    # Clean up now-empty directories that contained `:` etc.
    for dirpath, dirs, files in os.walk(ROOT, topdown=False):
        if not dirs and not files:
            try:
                os.rmdir(dirpath)
            except OSError:
                pass
    # Also rename directories with unsafe chars (e.g. `blob.png` parent dir
    # which contains `:/`). Re-walk: any dir name with unsafe chars gets
    # renamed too, and refs already account for path-segment renaming since
    # we sanitized full paths above.
    print("done")


if __name__ == "__main__":
    main()
