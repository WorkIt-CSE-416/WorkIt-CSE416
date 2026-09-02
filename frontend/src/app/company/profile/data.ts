/**
 * What the company profile renders. Fixtures — swapping to real data touches
 * this file and nothing else.
 */

export const COMPANY = {
  name: "TechNova Solutions",
  location: "San Francisco, CA",

  /** One string per paragraph, so the page never parses prose to lay it out. */
  about: [
    "TechNova Solutions is a leading provider of enterprise cloud infrastructure, dedicated to helping businesses scale seamlessly in the digital age. Founded in 2014, we've built a reputation for robust, secure, and highly adaptable software architectures that power some of the world's most demanding applications.",
    "We believe that technology should empower human potential, not complicate it. Our team of dedicated engineers, designers, and strategists work collaboratively to simplify complex challenges, delivering elegant solutions with measurable impact.",
  ],

  mission:
    "To accelerate global innovation by providing unshakeable digital foundations for tomorrow's enterprises.",
} as const;

/**
 * The figures panel, in the order it reads.
 *
 * `href` is what makes a row a link rather than a value — only the website has
 * one today. Keeping it optional on the row beats a separate WEBSITE constant
 * and a second block of markup to render it: the panel stays one list, and a
 * second linked fact costs a line here and nothing on the page.
 */
export type OverviewFact = { label: string; value: string; href?: string };

export const OVERVIEW: OverviewFact[] = [
  { label: "Industry", value: "Cloud Computing" },
  { label: "Company Size", value: "500 - 1,000" },
  { label: "Founded", value: "2014" },
  { label: "Type", value: "Private" },
  { label: "Website", value: "technova.io", href: "https://technova.io" },
];
