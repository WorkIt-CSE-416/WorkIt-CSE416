import type { Metadata } from "next";

import { Composer } from "./composer";

export const metadata: Metadata = {
  title: "Post a Job",
  description: "Create a new job posting.",
};

/**
 * /company/jobs/new — where the top bar's "Post a Job" lands.
 *
 * It sits under /company/jobs rather than at /company/new so the sidebar's
 * "Job Postings" lights up while a role is being written: that item matches on
 * its subtree, which is what the note in ../../company-sidebar.tsx anticipated.
 *
 * Everything is in ./composer.tsx because both columns read one draft — see the
 * note there. No <main>: the shell's SidebarInset is the landmark for every
 * screen under /company.
 */
export default function NewJobPage() {
  return <Composer />;
}
