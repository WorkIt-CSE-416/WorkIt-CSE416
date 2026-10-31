/**
 * Adding WorkIt to the student's Claude (KAN-383). Until Anthropic lists
 * WorkIt in its connector directory, the student adds it as a custom
 * connector, and this link opens Claude's Add Custom Connector dialog with
 * WorkIt's name and connector address filled in: the student only checks
 * them and confirms, never pastes a URL. Anthropic documents the link's
 * form (claude.com/docs/connectors/building/directory-vs-custom). Once the
 * listing is live, point CLAUDE_CONNECTOR_LINK at its directory page
 * (claude.ai/directory/connectors/<slug>) and every button follows.
 *
 * Server-side only: the connector's address is the API's, and API_URL is
 * never sent to the browser on its own. CONNECTOR_API_URL is the address
 * the API's OAuth metadata names (backend/app/config.py), so the two agree
 * when production reaches the API by more than one name.
 */

/** The name Claude shows for the connector. */
export const CONNECTOR_NAME = "WorkIt";

export function claudeConnectorLink(): string {
  const listed = process.env.CLAUDE_CONNECTOR_LINK;
  if (listed) return listed;
  const api = (
    process.env.CONNECTOR_API_URL ??
    process.env.API_URL ??
    "http://localhost:8000"
  ).replace(/\/+$/, "");
  const query = new URLSearchParams({
    modal: "add-custom-connector",
    connectorName: CONNECTOR_NAME,
    connectorUrl: `${api}/mcp`,
  });
  return `https://claude.ai/customize/connectors?${query}`;
}

/**
 * Starting the student's Claude on their written answers: what they send
 * it, the connector prompt's title (backend/app/connector/prompt.py
 * TITLE), and a new claude.ai chat with it already in the box, not sent.
 * claude.ai's `?q=` is undocumented and once sent the text by itself, so
 * Write with Claude also copies the trigger (app/(seeker)/auto-apply/write-with-claude.tsx).
 * Never put the student's data in the link: it lands in browser history.
 */
export const CLAUDE_TRIGGER = "Write my WorkIt answers";
export const CLAUDE_START_URL = `https://claude.ai/new?q=${encodeURIComponent(CLAUDE_TRIGGER)}`;
