export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN;

    const corsHeaders = {
      "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (url.pathname === "/videos" && request.method === "GET") {
        return await listVideos(env, corsHeaders);
      }
      if (url.pathname === "/login" && request.method === "POST") {
        return await login(request, env, corsHeaders);
      }
      if (url.pathname === "/add-video" && request.method === "POST") {
        return await addVideo(request, env, corsHeaders);
      }
      if (url.pathname.startsWith("/stream/") && request.method === "GET") {
        return await streamVideo(request, url, env, corsHeaders);
      }
      if (url.pathname.startsWith("/video/") && request.method === "DELETE") {
        return await deleteVideo(request, url, env, corsHeaders);
      }
      return new Response("Not found", { status: 404, headers: corsHeaders });
    } catch (err) {
      const status = err.status || 500;
      return new Response(JSON.stringify({ error: err.message }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};

// ---------- crypto helpers ----------

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function signJWT(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = b64url(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsigned = `${encHeader}.${encPayload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

async function verifyJWT(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) throw Object.assign(new Error("Malformed token"), { status: 401 });
  const [headerB64, payloadB64, sigB64] = parts;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!valid) throw Object.assign(new Error("Invalid signature"), { status: 401 });
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  if (payload.exp && Date.now() > payload.exp) {
    throw Object.assign(new Error("Token expired"), { status: 401 });
  }
  return payload;
}

async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) throw Object.assign(new Error("Missing token"), { status: 401 });
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (payload.role !== "admin") throw Object.assign(new Error("Not authorized"), { status: 403 });
  return payload;
}

// ---------- route handlers ----------

async function listVideos(env, corsHeaders) {
  const list = (await env.VIDEOS_KV.get("index", "json")) || [];
  const videos = [];
  for (const id of list) {
    const v = await env.VIDEOS_KV.get(`video:${id}`, "json");
    if (v) videos.push({ id, title: v.title, thumbnail: v.thumbnail || null });
  }
  return new Response(JSON.stringify(videos), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function login(request, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const password = body.password || "";
  const hash = await sha256(password + env.PASSWORD_SALT);

  if (hash !== env.ADMIN_PASSWORD_HASH) {
    return new Response(JSON.stringify({ error: "Invalid password" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = await signJWT(
    { role: "admin", exp: Date.now() + 1000 * 60 * 60 * 2 },
    env.JWT_SECRET
  );
  return new Response(JSON.stringify({ token }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function addVideo(request, env, corsHeaders) {
  await requireAdmin(request, env);
  const { title, url, thumbnail } = await request.json();
  if (!title || !url) {
    return new Response(JSON.stringify({ error: "Title and url are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const id = crypto.randomUUID();
  await env.VIDEOS_KV.put(`video:${id}`, JSON.stringify({ title, url, thumbnail: thumbnail || null }));

  const list = (await env.VIDEOS_KV.get("index", "json")) || [];
  list.push(id);
  await env.VIDEOS_KV.put("index", JSON.stringify(list));

  return new Response(JSON.stringify({ success: true, id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function deleteVideo(request, url, env, corsHeaders) {
  await requireAdmin(request, env);
  const id = url.pathname.split("/").pop();

  await env.VIDEOS_KV.delete(`video:${id}`);
  let list = (await env.VIDEOS_KV.get("index", "json")) || [];
  list = list.filter((v) => v !== id);
  await env.VIDEOS_KV.put("index", JSON.stringify(list));

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function streamVideo(request, url, env, corsHeaders) {
  const id = url.pathname.split("/").pop();
  const v = await env.VIDEOS_KV.get(`video:${id}`, "json");
  if (!v) return new Response("Not found", { status: 404, headers: corsHeaders });

  const upstreamHeaders = {};
  const range = request.headers.get("Range");
  if (range) upstreamHeaders["Range"] = range;

  const upstream = await fetch(v.url, { headers: upstreamHeaders });

  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "video/mp4");
  headers.set("Accept-Ranges", "bytes");
  const cl = upstream.headers.get("Content-Length");
  if (cl) headers.set("Content-Length", cl);
  const cr = upstream.headers.get("Content-Range");
  if (cr) headers.set("Content-Range", cr);

  return new Response(upstream.body, { status: upstream.status, headers });
}
