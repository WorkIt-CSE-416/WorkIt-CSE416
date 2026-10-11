import type { Metadata } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";

import { TooltipProvider } from "@/components/shadcn/tooltip";

import "./globals.css";

/**
 * Plus Jakarta Sans, not Geist, since KAN-173: rounder and warmer at the
 * medium weight the Dashboard's headings and figures now use. Geist Mono
 * stays for code-like figures; Jakarta has no mono.
 */
const jakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  /**
   * Pages set only their own name; the template appends the brand. Tabs get
   * truncated from the right, so the distinguishing word has to come first —
   * "Applications · WorkIt" survives a narrow tab, "WorkIt — Applications"
   * would not. `default` is what a page without its own title inherits.
   */
  title: { default: "WorkIt", template: "%s · WorkIt" },
  description: "CSE 416 final project",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakartaSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* Here rather than in a shell: every icon-only button carries a
            tooltip, and those are in both shells and the design kit. One
            provider is also what makes hovering along a row of them hand the
            tooltip straight from one to the next. */}
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
