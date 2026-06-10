#!/usr/bin/env python3
"""
Fix the half-rewritten logo references swap_logo.py left behind.

The previous regex terminated on the first comma, but wsimg URLs use
`,` inside the path, so we ended up with broken srcs like
`assets/logo.jpeg,cg:true,m/qt=q:95` and srcset entries containing
fragments like `https://h:380,cg:true,...`.

Walk every <img> tag whose data-ux marks it as a logo (or whose src
already starts with the assets/logo.jpeg sentinel) and set src to a
clean relative path to site/assets/logo.jpeg, drop srcset.
Also fix link[rel=icon] / og:image and any leftover wsimg PCGC Logo
URLs we missed by treating the whole URL as one token even when it
contains commas.
"""
import os
import re
from bs4 import BeautifulSoup

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")


def rel_to_logo(html_path):
    return os.path.relpath(
        os.path.join(ROOT, "assets", "logo.jpeg"),
        os.path.dirname(html_path),
    ).replace(os.sep, "/")


def is_logo_img(tag):
    attrs = tag.attrs
    if attrs.get("data-ux") == "ImageLogo":
        return True
    if attrs.get("data-aid", "").startswith("HEADER_LOGO"):
        return True
    src = attrs.get("src", "")
    if "logo.jpeg" in src or "PCGC" in src:
        return True
    alt = (attrs.get("alt") or "").lower()
    if "polk county golf carts" in alt and tag.name == "img":
        return True
    return False


# Match a full wsimg logo URL even with embedded commas: terminate only on
# quote or whitespace.
LEFTOVER_RE = re.compile(
    r"https?://img1\.wsimg\.com/[^\"'\s]*PCGC[^\"'\s]*",
    re.IGNORECASE,
)


def process(path):
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()
    soup = BeautifulSoup(html, "html.parser")
    rel = rel_to_logo(path)
    changes = 0

    for img in soup.find_all("img"):
        if not is_logo_img(img):
            continue
        if img.get("src") != rel:
            img["src"] = rel
            changes += 1
        if img.has_attr("srcset"):
            del img["srcset"]
            changes += 1
        # drop data-src too if present
        if img.has_attr("data-src"):
            img["data-src"] = rel
            changes += 1

    # link rel=icon / apple-touch-icon pointing at PCGC logo
    for link in soup.find_all("link"):
        href = link.get("href", "")
        if "PCGC" in href or "logo.jpeg" in href:
            link["href"] = rel
            changes += 1

    # meta og:image / twitter:image
    for meta in soup.find_all("meta"):
        prop = (meta.get("property") or meta.get("name") or "").lower()
        if prop in {"og:image", "og:image:url", "og:image:secure_url",
                    "twitter:image", "twitter:image:src", "msapplication-tileimage"}:
            content = meta.get("content", "")
            if "PCGC" in content or "logo.jpeg" in content or "wsimg.com" in content:
                meta["content"] = rel
                changes += 1

    html_out = str(soup)
    # Final scrub: any remaining unbroken wsimg PCGC URLs in inline CSS/JS
    new_out, n = LEFTOVER_RE.subn(rel, html_out)
    if n:
        html_out = new_out
        changes += n

    if changes:
        with open(path, "w", encoding="utf-8") as f:
            f.write(html_out)
        print(f"  {os.path.relpath(path, ROOT)}: {changes} fixes")
    return changes


total = 0
for dp, _, files in os.walk(ROOT):
    for fn in files:
        if fn.endswith(".html"):
            total += process(os.path.join(dp, fn))
print(f"\nTotal: {total} fixes")
