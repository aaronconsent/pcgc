# Polk County Golf Carts (pcgc)

Static site for polkcountygolfcarts.com, deployed as a Cloudflare Worker
with static assets plus a hidden `/rentals/` rental-booking flow backed
by Cloudflare KV.

## Layout

- `site/` — static assets (HTML/CSS/JS/images). Worker falls through
  to this for any request that isn't an `/api/booking` route.
- `build.py` — generates every page in `site/` from shared header /
  footer / contact-strip fragments. Run `python3 build.py` to rebuild.
- `gen_og.py` — generates 1200×630 social-share PNGs to
  `site/assets/og/`. Run after content edits that change titles.
- `src/worker.js` — Cloudflare Worker. Handles `POST /api/booking`
  (public) and `GET /api/booking` (admin, basic auth).
- `site/rentals/` — hidden customer-facing rental flow (`noindex`,
  not linked from primary nav).
- `site/admin/rentals/` — admin booking review UI.
- `wrangler.toml` — Worker config + KV + asset bindings.

## Local preview

```
python3 build.py
python3 gen_og.py        # only when titles/photos change
python3 -m http.server -d site 8000
```

Rental submissions need the deployed Worker to actually persist.

## Deploy

Cloudflare auto-deploys on every push to `main` via `npx wrangler
deploy`. KV namespace + admin password are already provisioned. To
rotate the password, set a new value in:

  **Cloudflare dashboard → Workers & Pages → pcgc → Settings →
  Variables and Secrets → FEEDBACK_ADMIN_PASS**

## Reviewing rental bookings

Visit `/admin/rentals/` on the deployed site. Browser prompts for HTTP
basic auth — enter `admin` and the password above. Newest first, with
trip dates, line items, contact details, and price breakdown.
