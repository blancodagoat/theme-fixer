import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixTheme } from "./convert.js";

const data = JSON.parse(readFileSync(new URL("./map.json", import.meta.url)));

const theme = {
  name: "test",
  spec: 2,
  semanticColors: {
    BACKGROUND_PRIMARY: ["#111111", "#eeeeee"],
    BACKGROUND_SECONDARY: ["#222222", "#dddddd"],
    CHAT_BACKGROUND: ["#333333", "#cccccc"],
    TEXT_NORMAL: ["#ffffff"],
    TEXT_DEFAULT: ["#abcdef"],
    TEXT_MUTED: ["#999999"],
    SOMETHING_DISCORD_REMOVED: ["#000000"],
    KEYBOARD: ["#123456"],
  },
  rawColors: { PRIMARY_500: "#4e67ad" },
};
const before = structuredClone(theme);
const { theme: fixed, added, unknown } = fixTheme(theme, data);
const sc = fixed.semanticColors;

assert.deepEqual(theme, before, "input is left alone");
assert.deepEqual(sc.BACKGROUND_BASE_LOW, ["#111111", "#eeeeee"]);
assert.deepEqual(sc.BACKGROUND_BASE_LOWER, ["#222222", "#dddddd"]);
assert.deepEqual(sc.CHANNEL_BACKGROUND_DEFAULT, ["#333333", "#cccccc"], "earlier map entries win");
assert.deepEqual(sc.TEXT_DEFAULT, ["#abcdef"], "keys already in the theme are never overwritten");
assert.deepEqual(sc.ICON_DEFAULT, ["#ffffff"]);
assert.deepEqual(sc.BACKGROUND_PRIMARY, ["#111111", "#eeeeee"], "old keys are kept");
assert.deepEqual(fixed.rawColors, theme.rawColors);
assert.ok(added.some((a) => a.from === "BACKGROUND_PRIMARY" && a.to === "BACKGROUND_BASE_LOW" && a.exact));
assert.ok(!added.some((a) => a.to === "TEXT_DEFAULT"));
assert.deepEqual(unknown, ["SOMETHING_DISCORD_REMOVED"]);

assert.throws(() => fixTheme({ spec: 3, semanticColors: {} }, data), /spec 3/);
assert.throws(() => fixTheme({ name: "nope" }, data), /semanticColors/);

for (const targets of Object.values(data.map)) {
  for (const { name } of targets) assert.ok(data.tokens.includes(name), `${name} is a real token`);
}

console.log("ok");
