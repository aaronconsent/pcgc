#!/usr/bin/env python3
"""Fetch additional pages the main crawl never reached (shop / category /
product pages), seeding the same crawler with explicit URLs. Run after
crawl.py finishes so we only fetch the pages that aren't already on disk."""
import os
import sys

# import the live module so we get fetch / process_page / queue
import crawl

# extra seeds — every internal link the saved pages reference but that
# wasn't crawled before we killed the run.
EXTRA = [
    "/golf-carts-for-sale/ols/categories/breezy-ev-golf-carts",
    "/golf-carts-for-sale/ols/cart",
    "/golf-carts-for-sale/ols/checkout",
    "/m/account",
    "/m/orders",
    "/contact",
]


def main():
    os.makedirs(crawl.OUT, exist_ok=True)
    # mark already-saved pages visited so we don't reprocess them
    for dp, _, files in os.walk(crawl.OUT):
        if "index.html" in files:
            rel = os.path.relpath(dp, crawl.OUT)
            path = "/" if rel in (".", "") else "/" + rel.replace(os.sep, "/")
            crawl.visited_pages.add(f"https://{crawl.ORIGIN}{path}")
    # but DO process the extras (even if they were enqueued before but never
    # processed) — clear them from visited so enqueue_page accepts them
    for path in EXTRA:
        url = f"https://{crawl.ORIGIN}{path}"
        crawl.visited_pages.discard(url)
        crawl.enqueue_page(url)

    while crawl.queue:
        url = crawl.queue.popleft()
        try:
            crawl.process_page(url)
        except Exception as e:
            print(f"  page error {url}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
