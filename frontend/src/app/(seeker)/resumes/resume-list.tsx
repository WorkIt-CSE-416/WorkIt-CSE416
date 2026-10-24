import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

/** The search's words, lowercased, as the picker splits them. */
export function searchWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether every word is in the text: "acme intern" finds "Intern at Acme". */
export function matches(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
}

/**
 * The Resumes page's list (KAN-362): every resume's card (an upload's
 * `ResumeRow`, a built resume's ./built-resume-row.tsx), newest first, in
 * one card that scrolls inside itself at one height (`max-h-scroll-box`),
 * as Top Matches and the resume picker do, so the search and the buttons
 * above it stay in view however many resumes a student keeps. The cards
 * hold all a resume needs: its name, one line saying what it is ("Uploaded
 * Oct 21", "Last edited Oct 21 · For …"), and its star, Rename, Download
 * and Delete. A table with Type and Last Edited columns, then with the
 * icons in one menu, came first in KAN-362: the columns said what each
 * card's line already says, and the menu hid the actions a student uses.
 */
export function ResumeList({ children }: { children: ReactNode }) {
  return (
    <Card as="section" aria-label="Your Resumes" padding="none" className="mt-4 overflow-hidden">
      {/* pt-1: room for a card's lift under the pointer, which the scroll
          would clip at the top. */}
      <ul role="list" className="max-h-scroll-box flex flex-col overflow-y-auto px-3 pt-1 pb-3">
        {children}
      </ul>
    </Card>
  );
}
