// usage: node smoke.mjs <worker url> [theme url]
// reads ADMIN_TOKEN from the environment or .dev.vars to test deletes
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const themeUrl = process.argv[3] ?? "https://raw.githubusercontent.com/blancodagoat/theme-fixer/main/test/theme.json";
const devVars = new URL("./.dev.vars", import.meta.url);
const token = process.env.ADMIN_TOKEN ?? (existsSync(devVars) && readFileSync(devVars, "utf8").match(/^ADMIN_TOKEN=(.+)$/m)?.[1].trim());
const theme = JSON.parse(readFileSync(new URL("../test/theme.json", import.meta.url)));

let res = await fetch(`${base}/fix?url=${encodeURIComponent(themeUrl)}`);
assert.equal(res.status, 200, await res.clone().text());
let body = await res.json();
assert.ok(body.semanticColors.BACKGROUND_BASE_LOW, "fix link adds new names");

res = await fetch(`${base}/fix?url=${encodeURIComponent(themeUrl)}`);
console.log("fix link cache:", res.headers.get("X-Cache") ?? "miss");

res = await fetch(`${base}/fix?url=http://example.com/theme.json`);
assert.equal(res.status, 400);
res = await fetch(`${base}/fix?url=${encodeURIComponent("https://api.github.com/repos/blancodagoat/theme-fixer")}`);
assert.equal(res.status, 400, "json that isn't a theme is rejected");

res = await fetch(`${base}/themes`, { method: "POST", body: JSON.stringify(theme) });
assert.equal(res.status, 201, await res.clone().text());
const { url } = await res.json();
assert.match(url, /\/themes\/[0-9a-f]{16}\.json$/);

res = await fetch(`${base}/themes`, { method: "POST", body: JSON.stringify(theme) });
assert.equal((await res.json()).url, url, "same theme, same link");

res = await fetch(url);
assert.equal(res.status, 200);
body = await res.json();
assert.deepEqual(body.semanticColors.BACKGROUND_BASE_LOW, theme.semanticColors.BACKGROUND_PRIMARY);

res = await fetch(`${base}/themes`, { method: "POST", body: JSON.stringify({ spec: 3, semanticColors: {} }) });
assert.equal(res.status, 400);
res = await fetch(`${base}/themes`, { method: "POST", body: "x".repeat(600 * 1024), keepalive: false, headers: { Connection: "close" } }).catch(() => null);
assert.ok(!res || res.status === 413, `oversized upload is refused (${res?.status})`);

res = await fetch(url, { method: "DELETE", headers: { Authorization: "Bearer wrong" } });
assert.equal(res.status, 401);
if (token) {
  res = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 204);
  res = await fetch(url);
  assert.equal(res.status, 404, "deleted theme is gone");
} else {
  console.log("no ADMIN_TOKEN, skipped delete");
}

console.log("ok");
