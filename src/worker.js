/**
 * PCGC site Worker — serves the static asset directory verbatim and
 * adds three JSON endpoints used by the feedback widget:
 *
 *   POST /api/feedback              public; saves a feedback record
 *   GET  /api/feedback              admin; lists recent records
 *   GET  /api/feedback/image/:key   admin; streams an attached image
 *
 * Admin endpoints require HTTP basic auth against the
 * FEEDBACK_ADMIN_USER (default "admin") + FEEDBACK_ADMIN_PASS secrets
 * configured via `wrangler secret put`.
 *
 * Storage:
 *   env.FEEDBACK_KV — one entry per submission, key = `fb:<ts>:<id>`
 *                     value = JSON record
 *   env.FEEDBACK_R2 — one object per attached image, key under `images/`
 */

const MAX_TEXT_LENGTH = 5000;
const MAX_IMAGES_PER_SUBMISSION = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const KV_LIST_LIMIT = 200;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/feedback" && request.method === "POST") {
      return submitFeedback(request, env);
    }
    if (url.pathname === "/api/feedback" && request.method === "GET") {
      return listFeedback(request, env);
    }
    if (
      url.pathname.startsWith("/api/feedback/image/") &&
      request.method === "GET"
    ) {
      return serveImage(request, env, url);
    }

    // Everything else flows to the static assets bound at env.ASSETS.
    return env.ASSETS.fetch(request);
  },
};

async function submitFeedback(request, env) {
  if (!env.FEEDBACK_KV || !env.FEEDBACK_R2) {
    return json({ error: "feedback storage not configured" }, 503);
  }
  try {
    const form = await request.formData();
    const text = (form.get("text") || "").toString().trim();
    const pageUrl = (form.get("url") || "").toString().slice(0, 2048);

    if (!text) return json({ error: "feedback text required" }, 400);
    if (text.length > MAX_TEXT_LENGTH) {
      return json({ error: "feedback too long" }, 400);
    }

    const ts = new Date().toISOString();
    const id = crypto.randomUUID().slice(0, 8);
    const ua = (request.headers.get("user-agent") || "").slice(0, 500);
    const ip = request.headers.get("cf-connecting-ip") || "";
    const country = request.cf?.country || "";

    const images = [];
    for (const entry of form.getAll("images")) {
      if (images.length >= MAX_IMAGES_PER_SUBMISSION) break;
      if (typeof entry === "string") continue;
      if (!entry || entry.size === 0) continue;
      if (entry.size > MAX_IMAGE_BYTES) continue;
      if (!entry.type || !entry.type.startsWith("image/")) continue;

      const safeName = (entry.name || "image")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(-80);
      const key = `images/${ts}-${id}-${images.length}-${safeName}`;
      await env.FEEDBACK_R2.put(key, await entry.arrayBuffer(), {
        httpMetadata: { contentType: entry.type },
      });
      images.push({
        key,
        name: entry.name,
        type: entry.type,
        size: entry.size,
      });
    }

    const record = { id, ts, text, url: pageUrl, ua, ip, country, images };
    await env.FEEDBACK_KV.put(`fb:${ts}:${id}`, JSON.stringify(record));

    return json({ ok: true, id });
  } catch (err) {
    return json({ error: String(err && err.message) || "submit failed" }, 500);
  }
}

async function listFeedback(request, env) {
  if (!env.FEEDBACK_KV) return json({ error: "kv not configured" }, 503);
  const auth = checkAdminAuth(request, env);
  if (auth) return auth;

  // Highest-ranked keys (newest ISO timestamps last alphabetically).
  const result = await env.FEEDBACK_KV.list({
    prefix: "fb:",
    limit: KV_LIST_LIMIT,
  });
  const keys = result.keys.slice().reverse();
  const entries = await Promise.all(
    keys.map(async (k) => {
      const raw = await env.FEEDBACK_KV.get(k.name);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
  );
  return json({ entries: entries.filter(Boolean) });
}

async function serveImage(request, env, url) {
  if (!env.FEEDBACK_R2) return new Response("r2 not configured", { status: 503 });
  const auth = checkAdminAuth(request, env);
  if (auth) return auth;

  const key = decodeURIComponent(
    url.pathname.replace("/api/feedback/image/", "")
  );
  if (!key.startsWith("images/")) {
    return new Response("bad key", { status: 400 });
  }
  const obj = await env.FEEDBACK_R2.get(key);
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type":
        obj.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "private, max-age=300",
    },
  });
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
      "WWW-Authenticate": 'Basic realm="PCGC feedback"',
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
