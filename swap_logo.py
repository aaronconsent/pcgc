#!/usr/bin/env python3
"""Replace every `img1.wsimg.com/.../PCGC Logo.jpg` reference (in src,
srcset, link href, og:image, etc.) with a relative path to the local
site/assets/logo.jpeg we added by hand."""
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
LOGO_REL = "assets/logo.jpeg"

# matches the full URL (with optional transform suffix) in any attribute
LOGO_URL_RE = re.compile(
    r"https?://img1\.wsimg\.com/[^\"'\s,)]*?PCGC(?:%20|\s|_)Logo\.jpg[^\"'\s,)]*",
    re.IGNORECASE,
)


def process(path):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    # rel path from this html file to site/assets/logo.jpeg
    rel = os.path.relpath(
        os.path.join(ROOT, LOGO_REL), os.path.dirname(path)
    ).replace(os.sep, "/")
    new_text, n = LOGO_URL_RE.subn(rel, text)
    if n:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_text)
        print(f"  {os.path.relpath(path, ROOT)}: {n} replacements")
    return n


total = 0
for dp, _, files in os.walk(ROOT):
    for fn in files:
        if fn.endswith(".html"):
            total += process(os.path.join(dp, fn))
print(f"\nTotal logo URL replacements: {total}")
