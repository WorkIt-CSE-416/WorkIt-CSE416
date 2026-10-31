import type { ImportResult } from "@/lib/bank-actions";

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** One sentence on what an import wrote into the experience bank, for My
 *  Profile's upload note and intake's import card alike. */
export function importSummary(result: ImportResult, filename: string | null): string {
  const from = filename ?? "your resume";
  const how = result.read_by === "model" ? ", read with AI" : "";
  if (result.found === 0) return `WorkIt couldn't find any entries in ${from}${how}.`;
  const added = [
    result.entries_added ? count(result.entries_added, "entry", "entries") : "",
    result.skills_added ? count(result.skills_added, "skill", "skills") : "",
  ].filter(Boolean);
  return `Added ${added.join(" and ")} from ${from}${how}.`;
}
