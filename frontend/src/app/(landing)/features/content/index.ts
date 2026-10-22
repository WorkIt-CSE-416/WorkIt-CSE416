import type { FeatureSlug } from "../catalog";
import type { FeatureContent } from "../types";
import autoApply from "./auto-apply";
import matching from "./matching";
import resumes from "./resumes";
import scout from "./scout";
import tracker from "./tracker";

/**
 * Every feature page's content, one file each, so each page is written
 * without touching another's file. All five are here from the start; edit a
 * page's own file, never this list.
 */
export const featureContent: Record<FeatureSlug, FeatureContent> = {
  resumes,
  matching,
  "auto-apply": autoApply,
  tracker,
  scout,
};
