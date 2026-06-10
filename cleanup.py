#!/usr/bin/env python3
"""
Post-crawl cleanup pass on site/.
- Strip any remaining wayback-rewritten URLs from HTML/CSS/JS.
- For wayback-wrapped URLs that point at a locally-downloaded asset, swap in
  a relative path. Otherwise unwrap to the original (likely-still-live)
  CDN URL so the page still renders.
"""
import os
import re
import sys
from urllib.parse import urlparse, unquote

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
ORIGIN = "polkcountygolfcarts.com"

# match wayback prefix in any of these shapes (with or without scheme,
# with or without an im_/cs_/if_ flag suffix on the timestamp).
WB_RE = re.compile(
    r"(?:https?:)?//web\.archive\.org/web/\d{14}[a-z_]*/"
    r"|/web/\d{14}[a-z_]*/"
)


def local_asset_for(orig_url):
    """Mirror the path scheme used by crawl.py.local_path_for for assets."""
    p = urlparse(orig_url)
    host = p.netloc.lower()
    path = unquote(p.path)
    if host in {ORIGIN, f"www.{ORIGIN}"}:
        rel = path.lstrip("/")
    else:
        rel = os.path.join("_external", host, path.lstrip("/"))
    if p.query:
        safe_q = re.sub(r"[^A-Za-z0-9._-]+", "_", p.query)
        root, ext = os.path.splitext(rel)
        rel = f"{root}__{safe_q}{ext}"
    if not rel or rel.endswith("/"):
        rel += "index"
    return os.path.join(ROOT, rel)


def rewrite_text(text, from_file):
    """For every wayback URL in text, swap it for a relative local path if
    the asset is on disk, otherwise the unwrapped original CDN URL."""
    def repl(m):
        # m.group(0) is the prefix; find the underlying URL right after it
        start = m.end()
        # consume the URL until a quote, space, paren, or whitespace
        end = start
        s = text  # closure access
        while end < len(s) and s[end] not in '"\'() \t\n\r>':
            end += 1
        inner = s[start:end]
        # normalize
        if not inner.startswith("http"):
            inner = "https://" + inner
        local = local_asset_for(inner)
        if os.path.exists(local):
            rel = os.path.relpath(local, os.path.dirname(from_file)).replace(os.sep, "/")
            return rel + s[end:end]  # no remainder injected here
        # no local copy — return live URL
        return inner

    # We need a single-pass replacement that consumes both the prefix and
    # the URL that follows it. Re-implement with a manual scan.
    out = []
    i = 0
    while True:
        m = WB_RE.search(text, i)
        if not m:
            out.append(text[i:])
            break
        out.append(text[i:m.start()])
        start = m.end()
        end = start
        while end < len(text) and text[end] not in '"\'() \t\n\r>':
            end += 1
        inner = text[start:end]
        if not inner.startswith("http"):
            inner = "https://" + inner
        local = local_asset_for(inner)
        if os.path.exists(local):
            rel = os.path.relpath(local, os.path.dirname(from_file)).replace(os.sep, "/")
            out.append(rel)
        else:
            out.append(inner)
        i = end
    return "".join(out)


def process_file(path):
    with open(path, "rb") as f:
        raw = f.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return 0
    if "web.archive.org" not in text and "/web/2026" not in text:
        return 0
    new_text = rewrite_text(text, path)
    if new_text != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_text)
        before = text.count("web.archive.org") + text.count("/web/2026")
        after = new_text.count("web.archive.org") + new_text.count("/web/2026")
        return before - after
    return 0


def main():
    targets = []
    for dirpath, _, files in os.walk(ROOT):
        for fn in files:
            if fn.endswith((".html", ".css", ".js")):
                targets.append(os.path.join(dirpath, fn))
    total = 0
    for p in targets:
        n = process_file(p)
        if n:
            print(f"{os.path.relpath(p, ROOT)}: removed {n} wayback refs")
            total += n
    print(f"\nDone. Removed {total} wayback references across {len(targets)} files.")


if __name__ == "__main__":
    main()
