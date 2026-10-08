import { ViewTransition, type ReactNode } from "react";

/**
 * The company shell's page, crossfading between sections the way the seeker
 * shell's does; see (seeker)/template.tsx.
 */
export default function CompanyTemplate({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
