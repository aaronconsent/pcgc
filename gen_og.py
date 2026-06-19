#!/usr/bin/env python3
"""
Generate page-specific 1200x630 social-sharing cards.

Each card composites a product photo with a dark gradient overlay, the
PCGC logo + brand wordmark in the top-left, a big serif page title in
the bottom-left, an optional subtitle line, and a coral brand bar.

Pipeline:
  1. Build an SVG (viewBox 1200x630) per page referencing the photo and
     logo via file:// URLs.
  2. Render with macOS qlmanage at -s 2400 (renders into a 2400x2400
     square, content scaled to fit width).
  3. Crop the top 2400x1260 strip with Pillow (preserveAspectRatio
     defaults letterbox the content to the TOP since we use yMin in the
     SVG), then resize down to 1200x630.

Run:  python3 gen_og.py

Outputs:
  site/assets/og/<slug>.png  (one per page)
"""

import base64
import os
import re
import shutil
import subprocess
import tempfile
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
PHOTOS = os.path.join(ROOT, "site", "assets", "photos")
LOGO_PATH = os.path.join(ROOT, "site", "assets", "logos", "logo-color.png")
OUT_DIR = os.path.join(ROOT, "site", "assets", "og")

# (slug, photo filename, title, subtitle, accent)
CARDS = [
    ("home",      "hero-sign-corvette.jpg",     "Brand-new. Refurbished. Used.",   "Polk County's family-owned golf cart shop"),
    ("carts",     "breezy-ev-lake-grass.jpg",   "The 2026 Breezy EV.",              "Lithium battery · 37 mph · 2-year warranty"),
    ("services",  "truck-towing-carts.jpg",     "Service. Custom. Anything cart.",  "20-point inspection · custom builds · free pickup"),
    ("about",     "owner-john.jpg",             "Family-owned. Locally trusted.",   "Serving our community since 2020"),
    ("contact",   "shop-exterior.jpg",          "Let's talk carts.",                "1732 FM 3277 · Livingston, TX · 936-223-1182"),
    ("privacy",   "breezy-ev-lakeside.jpg",     "Polk County Golf Carts",           "Privacy Policy"),
    ("rentals",   "rental-fleet-resort.jpg",    "Rent a golf cart in East Texas.",  "Up to 8 carts · free delivery within 25 mi"),
]


def escape_xml(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def data_uri(path):
    """Encode a local file as a data: URI for embedding in SVG."""
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext, "application/octet-stream")
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def wrap_title(title, max_chars=18):
    """Greedy word-wrap so each line fits roughly within the 1080-unit
    title column at the chosen font-size."""
    words = title.split()
    lines, current = [], ""
    for w in words:
        candidate = (current + " " + w).strip()
        if len(candidate) <= max_chars or not current:
            current = candidate
        else:
            lines.append(current)
            current = w
    if current:
        lines.append(current)
    return lines[:3]


def build_svg(photo, title, subtitle):
    """Build the SVG. preserveAspectRatio=xMidYMin meet pins the 1200x630
    viewBox to the TOP of qlmanage's square output, so a top-strip crop
    gets the whole card."""
    lines = wrap_title(title)
    # Choose font size + line geometry by number of lines
    if len(lines) == 1:
        title_size, line_h, first_y = 84, 96, 480
    elif len(lines) == 2:
        title_size, line_h, first_y = 72, 84, 410
    else:
        title_size, line_h, first_y = 60, 70, 360
    title_tspans = "".join(
        f'<tspan x="60" dy="{line_h if i else 0}">{escape_xml(line)}</tspan>'
        for i, line in enumerate(lines)
    )

    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 1200 630" width="1200" height="630"
     preserveAspectRatio="xMidYMin meet">
  <defs>
    <linearGradient id="overlay" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"   stop-color="#143238" stop-opacity="0.25"/>
      <stop offset="0.55" stop-color="#143238" stop-opacity="0.68"/>
      <stop offset="1"   stop-color="#143238" stop-opacity="0.94"/>
    </linearGradient>
    <linearGradient id="coralAccent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#e85a4f"/>
      <stop offset="1" stop-color="#c4453b"/>
    </linearGradient>
  </defs>

  <!-- Background photo (cover) — embedded as data URI so qlmanage
       always resolves it regardless of working directory. -->
  <image xlink:href="{data_uri(photo)}" x="0" y="0" width="1200" height="630" preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="0" width="1200" height="630" fill="url(#overlay)"/>

  <!-- Top-left: logo + brand -->
  <image xlink:href="{data_uri(LOGO_PATH)}" x="60" y="46" width="110" height="86" preserveAspectRatio="xMidYMid meet"/>
  <text x="184" y="92" font-family="Georgia,'Times New Roman',serif" font-size="32" fill="#fff" font-weight="700">Polk County Golf Carts</text>
  <text x="184" y="118" font-family="Helvetica,Arial,sans-serif" font-size="12" fill="#fff" fill-opacity="0.78" letter-spacing="4">LIVINGSTON · TEXAS</text>

  <!-- Coral accent bar before title -->
  <rect x="60" y="{first_y - title_size - 10}" width="100" height="6" fill="url(#coralAccent)" rx="3"/>

  <!-- Page title (multi-line if needed) -->
  <text font-family="Georgia,'Times New Roman',serif" font-size="{title_size}" fill="#fff" font-weight="700" y="{first_y}">{title_tspans}</text>

  <!-- Subtitle -->
  <text x="60" y="{first_y + (line_h * (len(lines) - 1)) + 44}" font-family="Helvetica,Arial,sans-serif" font-size="24" fill="#fff" fill-opacity="0.92">{escape_xml(subtitle)}</text>

  <!-- BBB tag bottom-right -->
  <g>
    <rect x="990" y="558" width="160" height="36" rx="18" fill="#fff" fill-opacity="0.14" stroke="#fff" stroke-opacity="0.55"/>
    <text x="1070" y="582" font-family="Helvetica,Arial,sans-serif" font-size="13" font-weight="700" fill="#fff" text-anchor="middle" letter-spacing="2">★ BBB ACCREDITED</text>
  </g>
</svg>
'''


def render_card(slug, photo_name, title, subtitle):
    photo = os.path.join(PHOTOS, photo_name)
    if not os.path.exists(photo):
        print(f"  ! missing photo: {photo}")
        return False
    svg = build_svg(photo, title, subtitle)

    with tempfile.TemporaryDirectory() as tmp:
        svg_path = os.path.join(tmp, f"{slug}.svg")
        with open(svg_path, "w") as f:
            f.write(svg)

        # qlmanage renders into <slug>.svg.png inside the output dir
        subprocess.run(
            ["/usr/bin/qlmanage", "-t", "-s", "2400", "-o", tmp, svg_path],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        rendered = os.path.join(tmp, f"{slug}.svg.png")
        if not os.path.exists(rendered):
            print(f"  ! qlmanage failed for {slug}")
            return False

        # qlmanage renders the SVG into a 2400x2400 square, ignoring our
        # preserveAspectRatio hint and stretching the content to fill the
        # full canvas. Resize the whole render to the OG aspect (1200x630)
        # — this undoes qlmanage's vertical stretch and restores the
        # intended layout.
        img = Image.open(rendered).convert("RGB")
        out = img.resize((1200, 630), Image.LANCZOS)
        out_path = os.path.join(OUT_DIR, f"{slug}.png")
        out.save(out_path, "PNG", optimize=True)
        size_kb = os.path.getsize(out_path) // 1024
        print(f"  wrote {os.path.relpath(out_path, ROOT)} ({size_kb} KB)")
        return True


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    ok = 0
    for slug, photo, title, subtitle in CARDS:
        if render_card(slug, photo, title, subtitle):
            ok += 1
    print(f"\nDone. {ok}/{len(CARDS)} cards generated in {OUT_DIR}/")


if __name__ == "__main__":
    main()
