import { Google_Sans } from "next/font/google";

import { cn } from "@/lib/cn";

import { Footer } from "./footer";
import { Header } from "./header";
import "./landing.css";
import { SmoothScroll } from "./smooth-scroll";

/** Only for the "Sign up with Google / LinkedIn" buttons: Google's branding
 *  guidelines require Google Sans Medium on the Google sign-in button. */
const googleSans = Google_Sans({
  variable: "--font-google-sans",
  weight: "500",
  subsets: ["latin"],
});

/**
 * The marketing pages' shell: the home page, the feature pages, Pricing,
 * the Resources pages and the legal pages.
 * No app bar or sidebar; every page in the group shares the floating
 * header and the footer, and renders its own `<main id="main">`, the skip
 * link's target. `.landing` scopes landing.css.
 */
export default function LandingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={cn("landing flex flex-1 flex-col overflow-x-clip", googleSans.variable)}>
      <SmoothScroll />
      {/* The first Tab stop, as on the app's shell ((seeker)/layout.tsx):
          without it six header links came before the page (KAN-580). The
          padding is focus: too, since sr-only zeroes it. */}
      <a
        href="#main"
        className="bg-panel rounded-control text-label text-ink shadow-panel sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2"
      >
        Skip to Content
      </a>
      <Header />
      {children}
      <Footer />
    </div>
  );
}
