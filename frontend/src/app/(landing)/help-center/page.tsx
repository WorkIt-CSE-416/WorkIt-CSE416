import { RESOURCES } from "../resources/catalog";
import { ComingSoonPage, comingSoonMetadata } from "../resources/coming-soon";

export const metadata = comingSoonMetadata(RESOURCES.help);

/** /help-center: a coming-soon placeholder until the real page replaces this file
 *  (resources/catalog.ts). */
export default function HelpCenterPage() {
  return <ComingSoonPage resource={RESOURCES.help} />;
}
