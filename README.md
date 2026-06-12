# Polk County Golf Carts (pcgc)

Static site for polkcountygolfcarts.com, deployed as a Cloudflare Worker
with static assets and a small `/api/feedback` endpoint backed by KV + R2.

## Layout

- `site/` — static assets (HTML/CSS/JS/images). Worker falls through to
  this for any request that isn't an `/api/feedback*` route.
- `build.py` — generates every page in `site/` from shared header /
  footer / contact-strip fragments. Run `python3 build.py` to rebuild.
- `src/worker.js` — Cloudflare Worker. Handles `POST /api/feedback`
  (public) and `GET /api/feedback{,/image/:key}` (admin, basic auth).
- `site/admin/feedback/` — admin UI that lists submitted feedback;
  shares its auth with the GET endpoints above.
- `wrangler.toml` — Worker config + KV / R2 / asset bindings.

## Local preview (static only)

```
python3 build.py
python3 -m http.server -d site 8000
```

The feedback widget will be present but submissions need the deployed
Worker to land.

## Deploy

Cloudflare auto-deploys on every push to `main` (it runs the **Deploy
command** `npx wrangler deploy`). Before the first deploy with the
feedback feature, run the one-time setup on a machine with `wrangler`:

```sh
# 1. Create the KV namespace and paste the returned id into
#    wrangler.toml (replace REPLACE_WITH_KV_NAMESPACE_ID).
npx wrangler kv:namespace create FEEDBACK_KV

# 2. Create the R2 bucket that stores attached images.
npx wrangler r2 bucket create pcgc-feedback

# 3. Set the admin password (and optionally a non-default user).
npx wrangler secret put FEEDBACK_ADMIN_PASS
# optional:
npx wrangler secret put FEEDBACK_ADMIN_USER

# 4. Deploy.
npx wrangler deploy
```

## Reviewing feedback

Visit `/admin/feedback/` on the deployed site. The browser will prompt
for HTTP basic auth — enter `FEEDBACK_ADMIN_USER` (default `admin`) and
`FEEDBACK_ADMIN_PASS`. The page lists every submission newest-first
with the page URL, timestamp, text, and inline image attachments.

## Files of interest

- `build.py` — page generation + the floating feedback widget HTML/JS
- `site/assets/site.css` — design system + `.pcgc-fb-*` widget styles
- `src/worker.js` — API endpoints
- `site/admin/feedback/index.html` — admin review UI
