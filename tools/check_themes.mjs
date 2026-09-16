// usage: node tools/check_themes.mjs <folder with theme .json files>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual as same } from "node:util";
import { fixTheme } from "../convert.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node tools/check_themes.mjs <folder>");
  process.exit(2);
}

const data = JSON.parse(readFileSync(new URL("../map.json", import.meta.url)));
const valid = new Set(data.tokens);
const order = Object.keys(data.map);
const failures = [];
const unmapped = {};
let checked = 0;
let rejected = 0;
let before = 0;
let after = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  let theme;
  try {
    theme = JSON.parse(readFileSync(join(dir, file), "utf8").replace(/^﻿/, ""));
  } catch {
    continue;
  }
  if (!theme?.semanticColors || typeof theme.semanticColors !== "object") continue;

  const original = structuredClone(theme);
  const fail = (msg) => failures.push(`${file}: ${msg}`);
  let result;
  try {
    result = fixTheme(theme, data);
  } catch (e) {
    if (/spec/.test(e.message)) rejected++;
    else fail(e.message);
    continue;
  }
  checked++;

  const { theme: out, added, unknown } = result;
  const sc = original.semanticColors;
  if (!same(theme, original)) fail("input was changed");
  for (const [key, value] of Object.entries(original)) {
    if (key === "semanticColors" || (key === "spec" && result.specFixed)) continue;
    if (!same(out[key], value)) fail(`${key} changed`);
  }
  for (const [key, value] of Object.entries(sc)) {
    if (!same(out.semanticColors[key], value)) fail(`${key} was overwritten`);
  }
  for (const { from, to } of added) {
    if (!valid.has(to)) fail(`${to} isn't a real color name`);
    const winner = order.find((name) => name in sc && data.map[name].some((t) => t.name === to));
    if (from !== winner || !same(out.semanticColors[to], sc[from])) fail(`${to} should come from ${winner}`);
  }
  if (Object.keys(out.semanticColors).length !== Object.keys(sc).length + added.length) fail("unexpected keys");
  if (fixTheme(out, data).added.length) fail("fixing twice adds more");

  for (const key of unknown) unmapped[key] = (unmapped[key] ?? 0) + 1;
  before += Object.keys(sc).filter((k) => valid.has(k)).length;
  after += Object.keys(out.semanticColors).filter((k) => valid.has(k)).length;
}

console.log(`${checked} themes checked, ${rejected} rejected for their spec, ${failures.length} problems`);
console.log(`color names Discord ${data.discord} still uses: ${before} before, ${after} after`);
console.log("most common names with no replacement:");
for (const [key, count] of Object.entries(unmapped).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${count}\t${key}`);
}
if (failures.length) {
  console.log(failures.slice(0, 50).join("\n"));
  process.exit(1);
}
