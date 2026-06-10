# Polk County Golf Carts — static mirror

Static mirror of polkcountygolfcarts.com, captured from the
[Wayback Machine snapshot](https://web.archive.org/web/20260412063743/https://polkcountygolfcarts.com/)
of 2026-04-12.

## Layout
- `site/` — deployable static site (the Cloudflare Pages output dir)
- `crawl.py` — wayback-aware mirror crawler
- `cleanup.py` — post-crawl pass that strips remaining wayback rewrites

## Local preview
```
python3 -m http.server -d site 8000
```

## Cloudflare Pages
- Framework preset: **None**
- Build command: *(none)*
- Build output directory: `site`

The repo is deploy-ready — Pages serves `site/` verbatim.
