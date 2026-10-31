import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign-In & Security" };

/** /settings/security: the address only. Settings is always a modal, drawn by
 *  ../layout.tsx on a hard load and ../../@modal/(.)settings on a soft
 *  navigation, with every section in it (KAN-364). */
export default function Page() {
  return null;
}
