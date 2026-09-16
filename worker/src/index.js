import { fixTheme } from "../../convert.js";
import data from "../../map.json";

const MAX_BYTES = 512 * 1024;
const THEME_PATH = /^\/themes\/([0-9a-f]{16})(?:\.json)?$/;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST",
  "Access-Control-Allow-Headers": "Content-Type",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
      }
      if (url.pathname === "/fix" && request.method === "GET") {
        return await fixLink(request, url, env, ctx);
      }
      if (url.pathname === "/themes" && request.method === "POST") {
        return await upload(request, url, env);
      }
      const match = url.pathname.match(THEME_PATH);
      if (match && request.method === "GET") return await stored(match[1], env);
      if (match && request.method === "DELETE") return await remove(request, match[1], env);
      throw new HttpError(404, "Nothing here. The theme fixer is at https://blancodagoat.github.io/theme-fixer/");
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(JSON.stringify({ message: e.message, stack: e.stack, path: url.pathname }));
      return json({ error: "Something went wrong on our side." }, 500);
    }
  },
};

async function fixLink(request, url, env, ctx) {
  let source;
  try {
    source = new URL(url.searchParams.get("url"));
  } catch {
    throw new HttpError(400, "Add ?url= with a link to a theme.");
  }
  if (source.protocol !== "https:") throw new HttpError(400, "Only https links are supported.");
  if (source.hostname === url.hostname) throw new HttpError(400, "That link is already fixed.");

  const cacheKey = new Request(`${url.origin}/fix?url=${encodeURIComponent(source.href)}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set("X-Cache", "hit");
    return response;
  }

  await limit(env.FIX_LIMIT, request);
  let res;
  try {
    res = await fetch(source, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "theme-fixer" } });
  } catch {
    throw new HttpError(502, "Couldn't download the theme from that link.");
  }
  if (!res.ok || !res.body) throw new HttpError(502, `The theme link answered with HTTP ${res.status}.`);

  const response = json(fix(await readLimited(res.body)), 200, { "Cache-Control": "public, max-age=600" });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

async function upload(request, url, env) {
  await limit(env.UPLOAD_LIMIT, request);
  if (!request.body) throw new HttpError(400, "Send the theme JSON as the request body.");
  if (Number(request.headers.get("Content-Length")) > MAX_BYTES) throw new HttpError(413, "Themes can be at most 512 KB.");

  const body = JSON.stringify(fix(await readLimited(request.body)), null, 4) + "\n";
  const id = await hash(body);
  if ((await env.THEMES.get(id)) === null) {
    try {
      await env.THEMES.put(id, body);
    } catch (e) {
      console.error(JSON.stringify({ message: "kv put failed", error: e.message }));
      throw new HttpError(503, "Uploads are full for today. Try again tomorrow, or load the theme from a link instead.");
    }
  }
  return json({ url: `${url.origin}/themes/${id}.json` }, 201);
}

async function stored(id, env) {
  const body = await env.THEMES.get(id, "stream");
  if (!body) throw new HttpError(404, "There's no theme at this link. It may have been removed.");
  return new Response(body, {
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

async function remove(request, id, env) {
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_TOKEN || !(await sameSecret(token, env.ADMIN_TOKEN))) throw new HttpError(401, "Not allowed.");
  await env.THEMES.delete(id);
  return new Response(null, { status: 204, headers: CORS });
}

function fix(text) {
  let theme;
  try {
    theme = JSON.parse(text);
  } catch {
    throw new HttpError(400, "That isn't valid JSON.");
  }
  try {
    return fixTheme(theme, data).theme;
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

async function readLimited(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "Themes can be at most 512 KB.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function limit(limiter, request) {
  const { success } = await limiter.limit({ key: request.headers.get("CF-Connecting-IP") ?? "unknown" });
  if (!success) throw new HttpError(429, "Too many requests. Wait a minute and try again.");
}

async function hash(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sameSecret(a, b) {
  const encoder = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", encoder.encode(s))));
  return crypto.subtle.timingSafeEqual(x, y);
}

function json(value, status, headers = {}) {
  return new Response(JSON.stringify(value, null, 4) + "\n", {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
