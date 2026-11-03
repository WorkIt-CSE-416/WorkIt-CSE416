"use client";

import { hydrateNear } from "./near";

/**
 * The home page's sections below the hero, each hydrating only as it comes
 * near (near.tsx). In a client module, since a server component's `import()`
 * of a client component is not split into its own chunk. The bridge starts
 * at the hero's foot, so it is near at once, but hydrating as its own piece
 * it no longer adds to the first screen's long task. The hero stays eager.
 */
export const Bridge = hydrateNear(() => import("./bridge").then((m) => m.Bridge));
export const ProductTour = hydrateNear(() => import("./product-tour").then((m) => m.ProductTour));
export const HiringSystemsSection = hydrateNear(() =>
  import("./hiring-pipeline").then((m) => m.HiringSystemsSection),
);
export const Statement = hydrateNear(() => import("./statement").then((m) => m.Statement));
export const Applications = hydrateNear(() => import("./applications").then((m) => m.Applications));
