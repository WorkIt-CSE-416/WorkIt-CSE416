/**
 * The card a link to WorkIt unfurls into, in iMessage, Slack, LinkedIn and the
 * like. A plain file in `public/`, not a generated `opengraph-image`: it is
 * served as a static asset, so a crawler gets it without the Worker or the
 * proxy, and it needs no image rendering on Cloudflare.
 */
export const SHARE_IMAGE = {
  url: "/og-image.jpg",
  width: 2400,
  height: 1260,
  alt: "WorkIt: Stop filling out applications by hand.",
};

/** Set on the root layout, and spread by any page that sets its own
 * `openGraph`: Next replaces the parent's object whole, so a page that sets
 * only a title there loses the image. */
export const SHARE_DEFAULTS = {
  type: "website" as const,
  siteName: "WorkIt",
  images: [SHARE_IMAGE],
};
