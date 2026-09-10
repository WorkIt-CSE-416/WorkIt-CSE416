import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
