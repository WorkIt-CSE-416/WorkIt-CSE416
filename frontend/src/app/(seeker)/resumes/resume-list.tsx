import type { ReactNode } from "react";

import { ResumeScroll } from "@/components/resume-list";
import { Card } from "@/components/ui/card";

/**
 * The Resumes page's list (KAN-362): every resume's card (an upload's
 * `ResumeRow`, a built resume's ./built-resume-row.tsx) under its group's
 * heading (`ResumeGroup`, KAN-404), in one card that scrolls inside itself
 * (`ResumeScroll`, components/resume-list.tsx, shared with the resume
 * picker since KAN-406) down to the foot of the page (`fill`, KAN-434), so
 * the search and the buttons above it stay in view however many resumes a
 * student keeps. The cards hold all a resume
 * needs: its name, one line saying what it is ("Uploaded Oct 21", "Last
 * edited Oct 21 · For …"), and its star, Rename, Download and Delete. A
 * table with Type and Last Edited columns, then with the icons in one menu,
 * came first in KAN-362: the columns said what each card's line already
 * says, and the menu hid the actions a student uses.
 */
export function ResumeList({ children }: { children: ReactNode }) {
  return (
    <Card as="section" aria-label="Your Resumes" padding="none" className="mt-4 overflow-hidden">
      <ResumeScroll fill>{children}</ResumeScroll>
    </Card>
  );
}
