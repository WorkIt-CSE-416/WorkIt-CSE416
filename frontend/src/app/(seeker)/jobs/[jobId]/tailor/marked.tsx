/**
 * A line as plain text with its resume formatting shown: **bold** and
 * *italic*, the only marks a LaTeX resume's words carry here (backend
 * services/latex_source/inline.py). Anything else is printed as typed, and
 * a line with no marks is just its text.
 */
const MARKS = /\*\*(.+?)\*\*|\*([^*\s][^*]*?)\*/g;

export function Marked({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const match of text.matchAll(MARKS)) {
    out.push(text.slice(pos, match.index));
    out.push(
      match[1] != null ? (
        <strong key={match.index}>{match[1]}</strong>
      ) : (
        <em key={match.index}>{match[2]}</em>
      ),
    );
    pos = match.index + match[0].length;
  }
  out.push(text.slice(pos));
  return <>{out}</>;
}
