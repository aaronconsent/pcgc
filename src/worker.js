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

  // Notify the owner via Resend. Failure here must NEVER fail the
  // booking — the record is already saved in KV; the email is a
  // convenience layer on top.
  if (env.RESEND_API_KEY) {
    try {
      await sendBookingEmail(record, env);
    } catch (e) {
      console.error("booking email failed:", e?.message || e);
    }
  }

  return json({ ok: true, id });
}

// Send the booking notification through Resend's HTTP API. The owner
// receives a single email at BOOKING_TO_EMAIL with the customer's
// name in the From display and the customer's email in Reply-To, so
// hitting "Reply" in Yahoo Mail goes straight to the customer.
//
// Requires Cloudflare Worker secrets:
//   RESEND_API_KEY       — from resend.com/api-keys
//   BOOKING_FROM_EMAIL   — verified sender, e.g. bookings@polkcountygolfcarts.com
//   BOOKING_TO_EMAIL     — recipient, defaults to polkcountygolfcarts@yahoo.com
async function sendBookingEmail(record, env) {
  const from = env.BOOKING_FROM_EMAIL || "bookings@polkcountygolfcarts.com";
  const to = env.BOOKING_TO_EMAIL || "polkcountygolfcarts@yahoo.com";
  const customer = record.contact || {};
  const fromWithName = `${displayName(customer.name)} via PCGC Bookings <${from}>`;
  const replyTo = customer.email
    ? `${displayName(customer.name)} <${customer.email}>`
    : undefined;

  const dates = record.dates || {};
  const subject = `New rental booking · ${customer.name || "(no name)"} · ${dates.start || "?"} → ${dates.end || "?"}`;

  const body = {
    from: fromWithName,
    to: [to],
    subject,
    html: renderBookingHtml(record),
    text: renderBookingText(record),
  };
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`resend ${res.status}: ${text}`);
  }
}

function displayName(s) {
  // Strip anything that could mess up an RFC5322 display name. Quote
  // if it contains characters that need quoting.
  const cleaned = String(s || "Customer").replace(/[<>"]+/g, "").trim() || "Customer";
  return /[,;:()@\\]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtMoney(n) { return "$" + Number(n || 0).toFixed(2); }

function renderBookingHtml(r) {
  const c = r.contact || {};
  const d = r.dates || {};
  const p = r.pricing || {};
  const deliveryLabel = {
    pickup: "Pickup at shop (1732 FM 3277, Livingston)",
    local: "Free delivery (within 25 mi)",
    extended: "Extended delivery (25–100 mi, fee quoted separately)",
  }[r.delivery] || r.delivery || "(not specified)";

  const itemRows = (r.items || []).map(it => `
    <tr>
      <td style="padding:6px 0;">${escHtml(it.name)} × ${it.qty}</td>
      <td style="padding:6px 0; text-align:right;">${fmtMoney(it.lineTotal)}</td>
    </tr>
  `).join("");

  return `<!doctype html><html><body style="font-family:system-ui,Arial,sans-serif; max-width:560px; margin:0 auto; padding:1rem;">
    <h2 style="color:#1f5a68; margin:0 0 .5rem;">New rental booking</h2>
    <p style="margin:0 0 1rem; color:#666;">Confirmation code: <b>${escHtml(r.id)}</b></p>

    <h3 style="margin:1rem 0 .35rem;">Customer</h3>
    <table style="width:100%; border-collapse:collapse; font-size:14px;">
      <tr><td style="width:120px; color:#888;">Name</td><td><b>${escHtml(c.name)}</b></td></tr>
      <tr><td style="color:#888;">Phone</td><td><a href="tel:${escHtml(c.phone)}">${escHtml(c.phone)}</a></td></tr>
      <tr><td style="color:#888;">Email</td><td><a href="mailto:${escHtml(c.email)}">${escHtml(c.email)}</a></td></tr>
      ${c.guests ? `<tr><td style="color:#888;">Guests</td><td>${escHtml(c.guests)}</td></tr>` : ""}
      ${c.address ? `<tr><td style="color:#888; vertical-align:top;">Address</td><td>${escHtml(c.address)}</td></tr>` : ""}
      ${c.notes ? `<tr><td style="color:#888; vertical-align:top;">Notes</td><td>${escHtml(c.notes)}</td></tr>` : ""}
    </table>

    <h3 style="margin:1rem 0 .35rem;">Booking</h3>
    <table style="width:100%; border-collapse:collapse; font-size:14px;">
      <tr><td style="width:120px; color:#888;">Pickup</td><td><b>${escHtml(d.start)}</b></td></tr>
      <tr><td style="color:#888;">Return</td><td><b>${escHtml(d.end)}</b></td></tr>
      <tr><td style="color:#888;">Days</td><td>${p.days || ""}</td></tr>
      <tr><td style="color:#888;">Delivery</td><td>${escHtml(deliveryLabel)}</td></tr>
    </table>

    <h3 style="margin:1rem 0 .35rem;">Carts</h3>
    <table style="width:100%; border-collapse:collapse; font-size:14px;">${itemRows}</table>

    <table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:1rem; border-top:1px solid #ddd;">
      <tr><td style="padding:6px 0; color:#888;">Subtotal</td><td style="padding:6px 0; text-align:right;">${fmtMoney(p.subtotal)}</td></tr>
      ${r.delivery === "extended" ? `<tr><td style="padding:6px 0; color:#888;">Extended delivery</td><td style="padding:6px 0; text-align:right;">Quoted separately</td></tr>` : ""}
      <tr><td style="padding:6px 0; color:#888;">Tax</td><td style="padding:6px 0; text-align:right;">${fmtMoney(p.tax)}</td></tr>
      <tr style="border-top:1px solid #ddd;"><td style="padding:6px 0;"><b>Total</b></td><td style="padding:6px 0; text-align:right;"><b>${fmtMoney(p.grand)}</b></td></tr>
    </table>

    <p style="margin:1.5rem 0 .25rem; font-size:13px; color:#888;">Reply to this email to message ${escHtml(c.name)} directly.</p>
    <p style="margin:.25rem 0; font-size:12px; color:#aaa;">Booking received ${escHtml(r.ts)} · IP ${escHtml(r.ip || "?")} (${escHtml(r.country || "?")})</p>
  </body></html>`;
}

function renderBookingText(r) {
  const c = r.contact || {};
  const d = r.dates || {};
  const p = r.pricing || {};
  const deliveryLabel = { pickup: "Pickup at shop", local: "Free delivery (within 25 mi)", extended: "Extended delivery (25-100 mi, fee quoted separately)" }[r.delivery] || r.delivery || "";
  const items = (r.items || []).map(it => `  - ${it.name} x ${it.qty}  ${fmtMoney(it.lineTotal)}`).join("\n");
  return [
    `New rental booking — ${r.id}`,
    ``,
    `Customer`,
    `  Name:  ${c.name}`,
    `  Phone: ${c.phone}`,
    `  Email: ${c.email}`,
    c.address ? `  Addr:  ${c.address}` : null,
    c.notes ? `  Notes: ${c.notes}` : null,
    ``,
    `Booking`,
    `  Pickup:   ${d.start}`,
    `  Return:   ${d.end}`,
    `  Days:     ${p.days}`,
    `  Delivery: ${deliveryLabel}`,
    ``,
    `Carts`,
    items,
    ``,
    `Subtotal:  ${fmtMoney(p.subtotal)}`,
    r.delivery === "extended" ? `Extended:  Quoted separately` : null,
    `Tax:       ${fmtMoney(p.tax)}`,
    `Total:     ${fmtMoney(p.grand)}`,
    ``,
    `Reply to this email to message ${c.name} directly.`,
  ].filter(Boolean).join("\n");
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
