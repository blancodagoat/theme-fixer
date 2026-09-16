const LOADER_KEYS = new Set(["KEYBOARD"]);

export function fixTheme(theme, data) {
  const sc = theme?.semanticColors;
  if (typeof theme !== "object" || !sc || typeof sc !== "object" || Array.isArray(sc)) {
    throw new Error("This doesn't look like a theme. It needs a semanticColors object.");
  }
  const specFixed = theme.spec === "2";
  if (theme.spec !== undefined && theme.spec !== 2 && !specFixed) {
    throw new Error(`Only spec 2 themes are supported, this one is spec ${JSON.stringify(theme.spec)}.`);
  }

  const fixed = structuredClone(theme);
  if (specFixed) fixed.spec = 2;
  const colors = fixed.semanticColors;
  const valid = new Set(data.tokens);
  const added = [];

  for (const [from, targets] of Object.entries(data.map)) {
    if (!(from in sc)) continue;
    for (const { name, exact } of targets) {
      if (name in colors) continue;
      colors[name] = structuredClone(sc[from]);
      added.push({ from, to: name, exact });
    }
  }

  const unknown = Object.keys(sc).filter((key) => !valid.has(key) && !(key in data.map) && !LOADER_KEYS.has(key));

  return { theme: fixed, added, unknown, specFixed };
}
