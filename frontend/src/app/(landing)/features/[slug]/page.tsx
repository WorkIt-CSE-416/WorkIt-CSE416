import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FEATURES, featurePages, isFeatureSlug } from "../catalog";
import { featureContent } from "../content";
import { FeaturePage } from "../feature-page";

/** The five pages are built at build time; any other slug is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return featurePages.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/features/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  if (!isFeatureSlug(slug)) return {};
  const { meta } = featureContent[slug];
  return { title: meta.title, description: meta.description };
}

/** /features/<slug>: one feature page, drawn by FeaturePage from its
 *  content file (features/content/<slug>.ts). */
export default async function FeatureRoute({ params }: PageProps<"/features/[slug]">) {
  const { slug } = await params;
  if (!isFeatureSlug(slug)) notFound();
  return <FeaturePage feature={FEATURES[slug]} />;
}
