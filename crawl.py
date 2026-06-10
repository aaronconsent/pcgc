#!/usr/bin/env python3
"""
Wayback Machine static mirror crawler for polkcountygolfcarts.com.

Source is a snapshot on web.archive.org. Approach:
- BFS-crawl same-origin HTML pages via the wayback /web/TIMESTAMP/<url> form
- Strip the wayback toolbar/banner so the saved page matches the original
- Reverse the wayback URL rewriting on every link / asset reference
- Download all referenced assets (CSS/JS/images/fonts) from any origin
  (the original site pulls images from img1.wsimg.com) and localize them
- Rewrite hrefs/srcs so the saved copy works when served as static files
"""
import os
import re
import sys
import time
from collections import deque
from urllib.parse import urljoin, urlparse, unquote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from bs4 import BeautifulSoup

TIMESTAMP = "20260412063743"
ORIGIN = "polkcountygolfcarts.com"
WB_PREFIX = f"https://web.archive.org/web/{TIMESTAMP}"
START = f"{WB_PREFIX}/https://{ORIGIN}/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 mirror-bot"

visited_pages = set()
saved_assets = set()
queue = deque()

# strip wayback flag suffixes from path segment immediately after timestamp:
#   /web/20260412063743im_/...  -> /web/20260412063743/...
#   /web/20260412063743cs_/...  -> /web/20260412063743/...
WB_FLAG_RE = re.compile(r"/web/(\d{14})[a-z_]+/")


def fetch(url, retries=4):
    last = None
    for i in range(retries):
        try:
            req = Request(url, headers={"User-Agent": UA})
            with urlopen(req, timeout=60) as r:
                return r.read(), r.headers.get_content_type(), r.geturl()
        except (URLError, TimeoutError, ConnectionError) as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def to_wb(url, flag=""):
    """Wrap an original URL in the wayback prefix for fetching."""
    return f"https://web.archive.org/web/{TIMESTAMP}{flag}/{url}"


def from_wb(url):
    """Given a wayback URL, return the underlying original URL.
    Returns None if it's not a wayback URL."""
    if not url:
        return None
    if url.startswith("//"):
        url = "https:" + url
    # absolute wayback URL
    m = re.search(r"https?://web\.archive\.org/web/\d{14}[a-z_]*/(.+)", url)
    if m:
        inner = m.group(1)
        if not inner.startswith("http"):
            inner = "https://" + inner
        return inner
    # path-only wayback URL (e.g. /web/20260412063743/https://...)
    m = re.match(r"^/web/\d{14}[a-z_]*/(.+)", url)
    if m:
        inner = m.group(1)
        if not inner.startswith("http"):
            inner = "https://" + inner
        return inner
    if url.startswith("http"):
        return url
    return None


def is_same_origin(orig_url):
    h = urlparse(orig_url).netloc.lower().lstrip(".")
    return h in {ORIGIN, f"www.{ORIGIN}"}


def local_path_for(orig_url, is_page=False):
    p = urlparse(orig_url)
    host = p.netloc.lower()
    path = unquote(p.path)
    # normalize wsimg image URLs: drop the :/rs=... transform suffix for filename
    if is_page:
        if path in ("", "/"):
            return os.path.join(OUT, "index.html")
        return os.path.join(OUT, path.strip("/"), "index.html")
    if host in {ORIGIN, f"www.{ORIGIN}"}:
        rel = path.lstrip("/")
    else:
        rel = os.path.join("_external", host, path.lstrip("/"))
    # querystring distinguishes wsimg transforms (rs=w:600 vs rs=w:1200)
    if p.query:
        safe_q = re.sub(r"[^A-Za-z0-9._-]+", "_", p.query)
        root, ext = os.path.splitext(rel)
        rel = f"{root}__{safe_q}{ext}"
    if not rel or rel.endswith("/"):
        rel += "index"
    return os.path.join(OUT, rel)


def rel_link(from_file, to_file):
    return os.path.relpath(to_file, os.path.dirname(from_file)).replace(os.sep, "/")


def save_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def download_asset(orig_url, flag="if_"):
    """Download a single asset by original URL, save locally, return path."""
    key = orig_url.split("#")[0]
    if key in saved_assets:
        return local_path_for(key)
    saved_assets.add(key)
    wb_url = to_wb(key, flag=flag)
    try:
        data, ctype, final = fetch(wb_url)
    except (HTTPError, URLError, TimeoutError) as e:
        print(f"  asset FAIL {key}: {e}", file=sys.stderr)
        return None
    path = local_path_for(key)
    # if CSS, rewrite url(...) refs inside it
    if ctype and "css" in ctype:
        text = data.decode("utf-8", errors="replace")
        text = rewrite_css(text, key, path)
        data = text.encode("utf-8")
    save_bytes(path, data)
    print(f"  asset {key} -> {os.path.relpath(path, OUT)}")
    return path


CSS_URL_RE = re.compile(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)")


def rewrite_css(text, css_orig_url, css_local_path):
    def repl(m):
        ref = m.group(1).strip()
        if ref.startswith("data:") or ref.startswith("#"):
            return f"url({ref})"
        # ref may be wayback-rewritten or original-relative
        inner = from_wb(ref)
        if inner is None:
            # relative to the CSS file's original URL
            inner = urljoin(css_orig_url, ref)
        local = download_asset(inner, flag="if_")
        if not local:
            return f"url({ref})"
        return f"url({rel_link(css_local_path, local)})"
    return CSS_URL_RE.sub(repl, text)


def enqueue_page(orig_url):
    # strip fragment + query for canonical key
    p = urlparse(orig_url)
    clean = f"{p.scheme}://{p.netloc}{p.path or '/'}"
    if clean in visited_pages:
        return
    if not is_same_origin(clean):
        return
    # only crawl http(s)
    if p.scheme not in ("http", "https"):
        return
    visited_pages.add(clean)
    queue.append(clean)


def process_page(orig_url):
    print(f"PAGE {orig_url}")
    try:
        data, ctype, final = fetch(to_wb(orig_url))
    except (HTTPError, URLError, TimeoutError) as e:
        print(f"  page FAIL: {e}", file=sys.stderr)
        return
    html = data.decode("utf-8", errors="replace")
    soup = BeautifulSoup(html, "html.parser")

    # strip wayback toolbar/banner & injected scripts
    for sel in [
        "#wm-ipp-base", "#wm-ipp-print", "#wm-ipp", "#donato",
        "script[src*='archive.org/_static']",
        "link[href*='archive.org/_static']",
    ]:
        for el in soup.select(sel):
            el.decompose()
    # remove the wayback comments + analytics injection
    for c in soup.find_all(string=lambda t: isinstance(t, type(soup.new_string(""))) and "archive.org" in str(t)):
        pass
    # drop inline scripts that reference archive.org
    for s in soup.find_all("script"):
        txt = (s.string or "") + " " + (s.get("src") or "")
        if "archive.org" in txt or "__wm." in txt:
            s.decompose()

    page_local = local_path_for(orig_url, is_page=True)

    # walk attrs that point at URLs
    URL_ATTRS = [
        ("a", "href"),
        ("link", "href"),
        ("script", "src"),
        ("img", "src"),
        ("img", "data-src"),
        ("source", "src"),
        ("source", "srcset"),
        ("img", "srcset"),
        ("iframe", "src"),
        ("video", "src"),
        ("video", "poster"),
        ("audio", "src"),
        ("form", "action"),
        ("meta", "content"),  # og:image etc — only download if URL
    ]

    def handle_url(raw):
        """Return (local_replacement, is_internal_page_orig_url_or_None)."""
        if not raw:
            return raw, None
        raw = raw.strip()
        if raw.startswith(("data:", "javascript:", "mailto:", "tel:", "#")):
            return raw, None
        inner = from_wb(raw)
        if inner is None:
            # original-relative
            inner = urljoin(orig_url, raw)
        ip = urlparse(inner)
        if ip.scheme not in ("http", "https"):
            return raw, None
        # sanity check — real URL paths don't contain spaces or control chars
        if " " in inner or "\n" in inner or "\t" in inner:
            return raw, None
        path = ip.path.lower()
        is_html = (
            path == "" or path.endswith("/") or path.endswith(".html")
            or "." not in os.path.basename(path)
        )
        if is_same_origin(inner) and is_html:
            page_orig = f"{ip.scheme}://{ip.netloc}{ip.path or '/'}"
            target_local = local_path_for(page_orig, is_page=True)
            return rel_link(page_local, target_local), page_orig
        # external page link — leave as original absolute URL
        if is_html and not is_same_origin(inner):
            return inner, None
        # asset
        local = download_asset(inner, flag="if_")
        if not local:
            return inner, None
        return rel_link(page_local, local), None

    def handle_srcset(raw):
        # wsimg URLs contain `,` inside paths (e.g. /rs=w:191,h:190); per spec
        # srcset candidates are separated by `, ` (comma + whitespace), so use
        # that as the delimiter instead of a bare comma.
        out = []
        for part in re.split(r",\s+", raw):
            part = part.strip()
            if not part:
                continue
            bits = part.split()
            url_part = bits[0]
            rest = " ".join(bits[1:])
            new_url, page = handle_url(url_part)
            if page:
                enqueue_page(page)
            out.append((new_url + (" " + rest if rest else "")))
        return ", ".join(out)

    for tag_name, attr in URL_ATTRS:
        for el in soup.find_all(tag_name):
            if attr not in el.attrs:
                continue
            if tag_name == "meta":
                prop = (el.get("property") or el.get("name") or "").lower()
                # only meta tags whose content is genuinely a URL
                if prop not in {
                    "og:image", "og:image:url", "og:image:secure_url",
                    "og:url", "twitter:image", "twitter:image:src",
                    "twitter:url", "msapplication-tileimage",
                }:
                    continue
            val = el.get(attr)
            if not val:
                continue
            if attr == "srcset":
                el[attr] = handle_srcset(val)
                continue
            new_val, page = handle_url(val)
            if page:
                enqueue_page(page)
            el[attr] = new_val

    # inline style attrs with url(...)
    for el in soup.find_all(style=True):
        el["style"] = CSS_URL_RE.sub(
            lambda m: _handle_inline_css(m, orig_url, page_local), el["style"]
        )

    # <style> blocks
    for st in soup.find_all("style"):
        if st.string:
            st.string = CSS_URL_RE.sub(
                lambda m: _handle_inline_css(m, orig_url, page_local), st.string
            )

    # add a <base> safety: not needed since we rewrote everything relative
    html_out = str(soup)
    # final scrub: any leftover web.archive.org references in attributes
    html_out = re.sub(
        r'(["\'\s=])https?://web\.archive\.org/web/\d{14}[a-z_]*/',
        r"\1",
        html_out,
    )
    save_bytes(page_local, html_out.encode("utf-8"))


def _handle_inline_css(m, page_orig_url, page_local_path):
    ref = m.group(1).strip()
    if ref.startswith("data:") or ref.startswith("#"):
        return f"url({ref})"
    inner = from_wb(ref) or urljoin(page_orig_url, ref)
    local = download_asset(inner, flag="if_")
    if not local:
        return f"url({ref})"
    return f"url({rel_link(page_local_path, local)})"


def main():
    os.makedirs(OUT, exist_ok=True)
    enqueue_page(f"https://{ORIGIN}/")
    # seed extra known paths from initial inspection
    for p in ["/golf-carts-for-sale", "/services", "/about-us", "/contact"]:
        enqueue_page(f"https://{ORIGIN}{p}")

    while queue:
        url = queue.popleft()
        process_page(url)
        time.sleep(0.3)

    print(f"\nDone. {len(visited_pages)} pages, {len(saved_assets)} assets.")


if __name__ == "__main__":
    main()
