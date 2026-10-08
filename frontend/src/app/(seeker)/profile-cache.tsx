"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

import type { ApplicantProfile } from "@/lib/profile-actions";
import type { ParsedResume, ResumeItem } from "@/lib/resume-actions";

/**
 * My Profile's data, kept for as long as the seeker shell stays mounted, so a
 * return visit renders it at once instead of from empty.
 *
 * It lives in the shell's layout rather than in a module variable on purpose:
 * signing out redirects to /login, outside this shell, which unmounts the
 * layout and drops the cache with it. A module variable would outlive the
 * session and show one account's resumes to whoever signs in next in the same
 * tab. A full page load starts it empty as well.
 *
 * The page still refetches in the background on every visit, so a cached
 * signed photo URL (valid an hour) is replaced before it expires, and a change
 * made in another tab still arrives.
 */
export type ProfileSnapshot = {
  resumes: ResumeItem[];
  shown: { id: string; parsed: ParsedResume } | null;
  avatarUrl: string | null;
  applicantProfile: ApplicantProfile | null;
};

type ProfileCache = {
  read: () => ProfileSnapshot | null;
  write: (snapshot: ProfileSnapshot) => void;
};

const ProfileCacheContext = createContext<ProfileCache | null>(null);

export function ProfileCacheProvider({ children }: { children: ReactNode }) {
  // A ref, not state: saving a snapshot must not re-render the whole shell.
  const snapshot = useRef<ProfileSnapshot | null>(null);
  const cache = useMemo<ProfileCache>(
    () => ({
      read: () => snapshot.current,
      write: (next) => {
        snapshot.current = next;
      },
    }),
    [],
  );
  return <ProfileCacheContext value={cache}>{children}</ProfileCacheContext>;
}

export function useProfileCache() {
  const cache = useContext(ProfileCacheContext);
  if (!cache)
    throw new Error("useProfileCache needs the ProfileCacheProvider in (seeker)/layout.tsx");
  return cache;
}
