/**
 * The Jobs page's two views (KAN-519): the large cards, or the split view, a
 * list of compact cards beside the open job. The choice is a cookie, so the
 * server draws the chosen view with no flash of the other; it stays with the
 * browser, as Key Requirements' folded state does. Its own module because the
 * action, the server's read and the switch all need these.
 */
export type JobsView = "cards" | "split";

export const JOBS_VIEW_COOKIE = "workit-jobs-view";
