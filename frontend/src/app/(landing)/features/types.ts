import type { ComponentType } from "react";

/**
 * One feature page's copy and visuals, in its own file under `content/`
 * (feature-page.tsx draws every page from one of these). The page's name,
 * icon and colour are its entry in catalog.ts.
 *
 * Every claim here is a claim about the product: keep it true to what the
 * app does today. Auto apply fills one application at a time and the
 * student clicks Submit on every one (auto-apply/architecture.md), so no
 * page says WorkIt submits or applies in parallel.
 */
export type FeatureContent = {
  /** One line under the name in the Product menu and on the other pages'
   *  related-feature cards. Short: the menu gives it about 30 characters
   *  a line, two lines at most. */
  line: string;
  /** The tab title (" · WorkIt" is added) and the search description. */
  meta: { title: string; description: string };
  hero: { title: string; subtitle: string };
  /** The animation shown large under the hero: a client component, drawn
   *  inside the home tour's `MotionConfig` and `Fit` at up to 520px wide.
   *  Without one the stage shows a placeholder panel (Scout, for now). */
  animation?: ComponentType;
  /** Three or four deep dives, text beside a visual, sides alternating. */
  sections: FeatureSection[];
  /** "How it works": three or four steps, in order. */
  howItWorks: { title: string; steps: { title: string; body: string }[] };
  faqs: { question: string; answer: string }[];
  /** The closing call to action, above the sign-up buttons. */
  cta: { title: string; subtitle: string };
};

export type FeatureSection = {
  /** A short label above the title. */
  eyebrow?: string;
  title: string;
  body: string;
  /** Up to four short points, each with a tick. */
  points?: string[];
  /** Fills the visual slot, sized to its panel. Without one the slot shows
   *  a placeholder in the feature's colour. */
  visual?: ComponentType;
};
