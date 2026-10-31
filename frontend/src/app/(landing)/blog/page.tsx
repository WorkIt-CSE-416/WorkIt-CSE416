import { RESOURCES } from "../resources/catalog";
import { ComingSoonPage, comingSoonMetadata } from "../resources/coming-soon";

export const metadata = comingSoonMetadata(RESOURCES.blog);

/** /blog: a coming-soon placeholder until the real page replaces this file
 *  (resources/catalog.ts). */
export default function BlogPage() {
  return <ComingSoonPage resource={RESOURCES.blog} />;
}
