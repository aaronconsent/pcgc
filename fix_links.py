#!/usr/bin/env python3
"""
Rewrite the handful of internal links that point at pages the Wayback
snapshot never captured (GoDaddy Online Store category and the
authenticated /m/account, /m/orders flows). For each, pick a sensible
existing page as the fallback so the static mirror has no broken
internal links.
"""
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")

# old href substring -> new href (same relative depth)
REPLACEMENTS = [
    # the shop category page wasn't archived — send to the gallery page
    ("golf-carts-for-sale/ols/categories/breezy-ev-golf-carts/index.html",
     "golf-carts-for-sale/index.html"),
    # account/orders flows weren't archived — funnel through /m/login
    ("../m/account/index.html", "../m/login/index.html"),
    ("../m/orders/index.html",  "../m/login/index.html"),
    ("../account/index.html",   "../login/index.html"),
    ("../orders/index.html",    "../login/index.html"),
    ("m/account/index.html",    "m/login/index.html"),
    ("m/orders/index.html",     "m/login/index.html"),
]

total = 0
for dp, _, files in os.walk(ROOT):
    for f in files:
        if not f.endswith(".html"):
            continue
        path = os.path.join(dp, f)
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
        orig = text
        for old, new in REPLACEMENTS:
            text = text.replace(f'href="{old}"', f'href="{new}"')
        if text != orig:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
            print(f"  fixed {os.path.relpath(path, ROOT)}")
            total += 1
print(f"\n{total} files updated")
