/**
 * PCGC site Worker — serves the static asset directory and exposes two
 * JSON endpoints used by the hidden rental flow:
 *
 *   POST /api/booking   public; saves a rental booking record
 *   GET  /api/booking   admin; lists recent bookings (basic auth)
 *
 * Admin endpoints require HTTP basic auth against the
 * FEEDBACK_ADMIN_USER (default "admin") + FEEDBACK_ADMIN_PASS secrets
 * configured via the Cloudflare dashboard.
 *
 * Storage: env.FEEDBACK_KV — one entry per booking under the
 * `booking:<iso-ts>:<6-char-id>` key, JSON value.
 */

const KV_LIST_LIMIT = 200;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/booking" && request.method === "POST") {
      return submitBooking(request, env);
    }
    if (url.pathname === "/api/booking" && request.method === "GET") {
      return listBookings(request, env);
    }
    if (url.pathname === "/api/availability" && request.method === "GET") {
      return checkAvailability(request, env, url);
    }

    // Legacy URLs from the original site — 301 to the new locations
    // so search engines (and bookmarks) move with us.
    if (url.pathname === "/about" || url.pathname === "/about/") {
      return Response.redirect(`${url.origin}/about-us/`, 301);
    }

    // Everything else flows to the static assets bound at env.ASSETS.
    return env.ASSETS.fetch(request);
  },
};

async function submitBooking(request, env) {
  if (!env.FEEDBACK_KV) return json({ error: "storage not configured" }, 503);
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  if (!payload || !payload.items || !Array.isArray(payload.items) || payload.items.length === 0) {
    return json({ error: "no items in booking" }, 400);
  }
  if (!payload.contact || !payload.contact.name || !payload.contact.email) {
    return json({ error: "missing contact details" }, 400);
  }

  const ts = new Date().toISOString();
  const idSuffix = crypto.randomUUID().slice(0, 6).toUpperCase();
  const id = "PCGC-" + idSuffix;
  const record = {
    ...payload,
    id,
    ts,
    ua: (request.headers.get("user-agent") || "").slice(0, 500),
    ip: request.headers.get("cf-connecting-ip") || "",
    country: request.cf?.country || "",
  };
  await env.FEEDBACK_KV.put(`booking:${ts}:${idSuffix}`, JSON.stringify(record));
  return json({ ok: true, id });
}

async function listBookings(request, env) {
  if (!env.FEEDBACK_KV) return json({ error: "kv not configured" }, 503);
  const auth = checkAdminAuth(request, env);
  if (auth) return auth;
  const result = await env.FEEDBACK_KV.list({ prefix: "booking:", limit: KV_LIST_LIMIT });
  const keys = result.keys.slice().reverse();
  const entries = await Promise.all(
    keys.map(async (k) => {
      const raw = await env.FEEDBACK_KV.get(k.name);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    })
  );
  return json({ entries: entries.filter(Boolean) });
}

// Public — used by the /rentals/ wizard to show booked carts as
// disabled tiles. No auth: this only reveals cart IDs and date ranges,
// never customer details. Two ranges overlap when start1 < end2 AND
// end1 > start2 (strict inequality so a return on Day X and a pickup
// on the same Day X don't conflict).
async function checkAvailability(request, env, url) {
  if (!env.FEEDBACK_KV) return json({ booked: [] }); // fail-open
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (!start || !end) return json({ error: "start and end required" }, 400);

  const booked = new Set();
  let cursor;
  try {
    do {
      const page = await env.FEEDBACK_KV.list({ prefix: "booking:", cursor });
      for (const k of page.keys) {
        const raw = await env.FEEDBACK_KV.get(k.name);
        if (!raw) continue;
        let rec;
        try { rec = JSON.parse(raw); } catch { continue; }
        const bs = rec.dates?.start;
        const be = rec.dates?.end;
        if (bs && be && bs < end && be > start) {
          for (const item of rec.items || []) {
            if (item.id) booked.add(item.id);
          }
        }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch (e) {
    // Anything goes wrong with KV → fail-open: return empty booked
    // list so the frontend shows all carts as available with a
    // "couldn't verify" notice.
    return json({ booked: [], error: String(e?.message || "unknown") });
  }

  return json({ booked: [...booked] });
}

// Returns a Response if auth fails, or null if it passes.
function checkAdminAuth(request, env) {
  if (!env.FEEDBACK_ADMIN_PASS) {
    return json({ error: "admin password not configured" }, 503);
  }
  const expectedUser = env.FEEDBACK_ADMIN_USER || "admin";
  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {
      decoded = "";
    }
    const [user, pass] = decoded.split(":", 2);
    if (user === expectedUser && pass === env.FEEDBACK_ADMIN_PASS) {
      return null;
    }
  }
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="PCGC admin"',
      "content-type": "text/plain",
    },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
