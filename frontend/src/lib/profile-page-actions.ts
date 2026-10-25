"use server";

import { getAutofillAnswers } from "@/lib/autofill-answers-actions";
import { getAvatar } from "@/lib/avatar-actions";
import { getProfile } from "@/lib/profile-actions";

/** Each part as its own read answers it, error and all. */
export type ProfilePageData = {
  avatar: Awaited<ReturnType<typeof getAvatar>>;
  profile: Awaited<ReturnType<typeof getProfile>>;
  answers: Awaited<ReturnType<typeof getAutofillAnswers>>;
};

/**
 * Everything My Profile reads on a visit (the photo, the profile and the
 * answer bank) in ONE server action, because Next runs server actions one at
 * a time. The page is a client page, and it used to call getAvatar,
 * getProfile and getAutofillAnswers from one effect. That looked parallel
 * but was not: the client router queues every server action behind the one
 * before it (Next's own docs say not to rely on `Promise.all` from the
 * client), so a first visit waited for three round trips in a row (each one
 * the proxy, a session read and an API GET), and a Save fired meanwhile
 * waited behind all three. Here, on the server, the three are plain function
 * calls with no queue, so `Promise.all` runs them together and the page pays
 * one round trip, as long as its slowest read.
 *
 * Each part keeps its own error, so one failed read never blanks the other
 * two: the page fills in what loaded and shows its one notice for the rest,
 * and a failed refetch keeps what a return visit already shows. None of the
 * three throws (each catches its own failure into `error`), which is why a
 * plain `Promise.all` is safe here. They stay exported on their own for
 * their other readers, which call them on the server: Settings' Personal
 * Details, the shell and the resume editor read getAvatar or getProfile, and
 * onboarding reads getAutofillAnswers. A read added to My Profile joins this
 * action rather than becoming a fourth call from the page.
 */
export async function getProfilePage(): Promise<ProfilePageData> {
  const [avatar, profile, answers] = await Promise.all([
    getAvatar(),
    getProfile(),
    getAutofillAnswers(),
  ]);
  return { avatar, profile, answers };
}
