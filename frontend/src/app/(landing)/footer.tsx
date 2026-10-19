import { Logo } from "@/components/logo";

import { site } from "./data";

/**
 * A dark rounded panel inset from the window, like the bands above it, that
 * opens on the site's tagline set large. The logo turns white with a filter:
 * the shared Logo draws its word in ink, which would vanish on ink.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="px-2 pb-2 sm:px-6 sm:pb-6">
      <div className="bg-ink rounded-[2rem] text-white lg:rounded-[3rem]">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 pt-16 pb-14 sm:px-10 md:grid-cols-[1.5fr_repeat(3,1fr)] lg:px-8">
          <div className="max-w-sm">
            <p className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {site.tagline}
            </p>
            <Logo size="card" className="mt-10 brightness-0 invert" />
          </div>

          {site.footer.map((column) => (
            <div key={column.title}>
              <h2 className="text-sm font-semibold">{column.title}</h2>
              <ul className="mt-4 grid gap-3">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="text-sm text-white/65 transition-colors hover:text-white"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mx-auto w-full max-w-6xl px-6 sm:px-10 lg:px-8">
          <div className="flex flex-col gap-4 border-t border-white/10 py-6 text-sm text-white/65 sm:flex-row sm:items-center sm:justify-between">
            <p>
              &copy; {year} {site.name}. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
