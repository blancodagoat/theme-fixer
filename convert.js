const LOADER_KEYS = new Set(["KEYBOARD"]);

export function fixTheme(theme, data) {
  if (!theme || typeof theme !== "object" || typeof theme.semanticColors !== "object") {
    throw new Error("This doesn't look like a theme. It needs a semanticColors object.");
  }
  if (theme.spec !== undefined && theme.spec !== 2) {
    throw new Error(`Only spec 2 themes are supported, this one is spec ${theme.spec}.`);
  }

  const fixed = structuredClone(theme);
  const colors = fixed.semanticColors;
  const valid = new Set(data.tokens);
  const added = [];

  for (const [from, targets] of Object.entries(data.map)) {
    if (!(from in theme.semanticColors)) continue;
    for (const { name, exact } of targets) {
      if (name in colors) continue;
      colors[name] = structuredClone(theme.semanticColors[from]);
      added.push({ from, to: name, exact });
    }
  }

  const unknown = Object.keys(theme.semanticColors).filter(
    (key) => !valid.has(key) && !(key in data.map) && !LOADER_KEYS.has(key),
  );

  return { theme: fixed, added, unknown };
}
