/** Where the editor's Back goes when nothing opened it (a direct visit):
 *  the Resumes view, which lists every built resume. Otherwise it goes to
 *  the page that opened it, such as Experiences (../../back-link.tsx). A
 *  plain module, so the server page and the phone layout share it. */
export const EDITOR_PARENT = { href: "/resumes", name: "Resumes" };
