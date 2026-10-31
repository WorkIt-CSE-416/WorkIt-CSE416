/** The live canary's comparisons (KAN-468). run.mjs reads live forms; this decides what changed.
 * Nothing here opens a page. */

/** @typedef {{ name: string, kind: string }} Field */

/** How a live form's fields differ from the saved forms' (`saved`: one Question set per saved form of
 * the same job system). A field every saved form has must be on the live form with the same kind,
 * and the live form must hold no kind the saved forms never had. Empty when nothing differs.
 * @param {Field[][]} saved @param {Field[]} live @returns {string[]} */
export function kindDiff(saved, live) {
  if (!live.length) return ["no fields read"];
  const liveKinds = new Map(live.map((f) => [f.name, f.kind]));
  const shared = saved[0].filter((f) => saved.every((set) => set.some((g) => g.name === f.name)));
  const diff = [];
  for (const { name, kind } of shared) {
    const now = liveKinds.get(name);
    if (now === undefined) diff.push(`${name}: missing (saved as ${kind})`);
    else if (now !== kind) diff.push(`${name}: read as ${now}, saved as ${kind}`);
  }
  const known = new Set(saved.flat().map((f) => f.kind));
  for (const { name, kind } of live) if (!known.has(kind)) diff.push(`${name}: kind ${kind}, which no saved form has`);
  return diff;
}
