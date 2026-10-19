import { Bot, MousePointerClick } from "lucide-react";
import Image from "next/image";

import { companions, hiringSystems } from "./data";

const COMPANION_ICONS = { extension: MousePointerClick, scout: Bot };

/**
 * The hiring systems WorkIt reads job postings from, as a row of rounded
 * logo tiles, then two cards for what helps you apply: after Calendly's
 * integrations grid and its suite cards. Logos come from Google's favicon
 * service, which next.config.ts already allows for company logos.
 */
export function HiringSystems() {
  return (
    <>
      <ul className="mx-auto mt-12 flex max-w-4xl flex-wrap justify-center gap-3">
        {hiringSystems.map((system) => (
          <li
            key={system.name}
            className="flex w-28 flex-col items-center gap-2.5 rounded-2xl bg-white px-3 py-4 ring-1 ring-slate-900/5"
          >
            <Image
              src={`https://www.google.com/s2/favicons?domain=${system.domain}&sz=128`}
              alt=""
              width={40}
              height={40}
              className="size-10 rounded-lg"
            />
            <span className="text-ink text-sm font-medium">{system.name}</span>
          </li>
        ))}
      </ul>

      <div className="mx-auto mt-6 grid max-w-4xl gap-3 sm:grid-cols-2">
        {companions.map((card) => {
          const Icon = COMPANION_ICONS[card.id];
          return (
            <div key={card.id} className="rounded-2xl bg-white p-6 ring-1 ring-slate-900/5">
              <span className="bg-landing-brand-100 text-landing-brand-700 flex size-9 items-center justify-center rounded-lg">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="text-ink mt-4 text-lg font-semibold">{card.title}</h3>
              <p className="text-ink-meta mt-1.5 text-sm/6">{card.body}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}
