import { Google_Sans } from "next/font/google";

import { cn } from "@/lib/cn";

import "./landing.css";

/** Only for the "Sign up with Google / LinkedIn" buttons: Google's branding
 *  guidelines require Google Sans Medium on the Google sign-in button. */
const googleSans = Google_Sans({
  variable: "--font-google-sans",
  weight: "500",
  subsets: ["latin"],
});

/**
 * The landing page's shell. It has no app bar or sidebar: the page brings
 * its own header and footer. `.landing` scopes landing.css.
 */
export default function LandingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={cn("landing flex flex-1 flex-col overflow-x-clip", googleSans.variable)}>
      {children}
    </div>
  );
}
