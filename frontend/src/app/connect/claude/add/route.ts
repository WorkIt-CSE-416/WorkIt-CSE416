import { claudeConnectorLink } from "@/lib/claude-connector";

/**
 * /connect/claude/add: sends the browser on to Claude's Add Custom Connector
 * dialog, WorkIt filled in (lib/claude-connector, KAN-383). The extension's
 * add-Claude step opens this (KAN-387): the link is built server-side from
 * the API's address, which the extension doesn't keep, so every button that
 * adds WorkIt to Claude follows the one helper, and the directory listing
 * once it is live. Public: it reads nothing of the student's.
 */
export function GET() {
  return Response.redirect(claudeConnectorLink(), 307);
}
