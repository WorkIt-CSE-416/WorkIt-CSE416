import type { Metadata } from "next";

import { KitNav } from "./nav";

export const metadata: Metadata = {
  title: { default: "Design kit", template: "%s · Design kit · WorkIt" },
  description: "Every token and component the app is built from.",
};

/**
 * The design kit's own shell.
 *
 * It sits outside both product shells on purpose. Rendering it inside the
 * seeker layout would put a top bar above a page whose whole job is to show
 * components in isolation, and would make every specimen inherit chrome it does
 * not need.
 *
 * The sections became routes rather than anchors on one page once the kit grew
 * past a screenful: an anchor list gives every section the same URL, so nobody
 * can link a teammate to the button variants, the browser's back button does
 * nothing useful, and every visit renders all seven sections to show one. A
 * route per section costs a nav and gives all three back.
 */
export default function DesignKitLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-app min-h-full flex-1">
      <div className="max-w-app mx-auto flex w-full flex-col gap-6 px-6 py-10 sm:px-12 md:flex-row md:gap-12">
        <KitNav />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
