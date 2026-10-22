import { RESOURCES } from "../../resources/catalog";
import { ComingSoonPage, comingSoonMetadata } from "../../resources/coming-soon";

export const metadata = comingSoonMetadata(RESOURCES.mcp);

/** /docs/mcp: a coming-soon placeholder until the real page replaces this file
 *  (resources/catalog.ts). */
export default function McpDocsPage() {
  return <ComingSoonPage resource={RESOURCES.mcp} />;
}
