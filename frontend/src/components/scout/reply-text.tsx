import { Fragment, type ReactNode } from "react";

/**
 * A Scout reply as elements: the prompt's whole formatting vocabulary
 * (workit_scout/prompt.py) — **bold**, and "- " bullets — and nothing more.
 * Not a markdown library on purpose: anything else a model sends stays plain
 * text, and React escapes all of it, so a reply can never inject markup.
 *
 * Runs on every streamed chunk, so a half-arrived "**" just shows as-is until
 * its closing pair lands.
 */
export function ReplyText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={blocks.length} className="flex list-disc flex-col gap-1 pl-5">
        {bullets.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // Models also bullet with "*" or "•" despite the prompt; render them the same.
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    // A stray heading reads fine as a bold line; a blank line is just spacing.
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading)
      blocks.push(
        <p key={blocks.length} className="font-semibold">
          {inline(heading[1])}
        </p>,
      );
    else if (line) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();

  return <div className="flex flex-col gap-2">{blocks}</div>;
}

/** **bold** to <strong>; every other character is text. */
function inline(line: string): ReactNode {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
