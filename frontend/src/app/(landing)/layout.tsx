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
 * header and the footer, and renders its own `<main>`. `.landing` scopes
 * landing.css.
 */
export default function LandingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={cn("landing flex flex-1 flex-col overflow-x-clip", googleSans.variable)}>
      <SmoothScroll />
      <Header />
      {children}
      <Footer />
    </div>
  );
}
