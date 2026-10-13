"use client";

/**
 * PROTOTYPE (KAN-193), throwaway: seven layouts of the intake screen on one
 * route, switchable with ?variant=A|B|C|D|E|F|G, plus ?bank=empty|some. Scripted
 * stand-in for the model (model.ts); press Send to play the next turn.
 * Sits outside the seeker shell so it needs no sign-in. Lives on a
 * throwaway branch and never merges.
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../(seeker)/gutter";
import { useIntake } from "./model";
import { PrototypeSwitcher } from "./switcher";
import * as A from "./variant-a";
import * as B from "./variant-b";
import * as C from "./variant-c";
import * as D from "./variant-d";
import * as E from "./variant-e";
import * as F from "./variant-f";
import * as G from "./variant-g";

const VARIANTS = [
  { key: "A", name: A.NAME, View: A.VariantA },
  { key: "B", name: B.NAME, View: B.VariantB },
  { key: "C", name: C.NAME, View: C.VariantC },
  { key: "D", name: D.NAME, View: D.VariantD },
  { key: "E", name: E.NAME, View: E.VariantE },
  { key: "F", name: F.NAME, View: F.VariantF },
  { key: "G", name: G.NAME, View: G.VariantG },
];

export default function Page() {
  return (
    <Suspense>
      <Prototype />
    </Suspense>
  );
}

function Prototype() {
  const params = useSearchParams();
  const current = params.get("variant") ?? "A";
  const bank = params.get("bank") === "some" ? "some" : "empty";
  const v = VARIANTS.find((x) => x.key === current) ?? VARIANTS[0];

  return (
    // Outside the seeker shell (no sign-in), so it supplies the @container/main
    // the variants size off.
    <div className="bg-app @container/main min-h-dvh">
      <div className={cn("max-w-app mx-auto w-full flex-1 py-6 pb-24", SEEKER_GUTTER)}>
        <h1 className="text-heading text-ink">Experience Bank</h1>
        <p className="text-body text-ink-meta mt-1 mb-5">
          Tell WorkIt what you&apos;ve done, one thing at a time.
        </p>
        {/* key: a new variant or bank starts the script over */}
        <Body key={`${v.key}-${bank}`} bank={bank} View={v.View} />
        <PrototypeSwitcher variants={VARIANTS} current={v.key} />
      </div>
    </div>
  );
}

function Body({ bank, View }: { bank: "empty" | "some"; View: (typeof VARIANTS)[number]["View"] }) {
  const intake = useIntake(bank);
  return <View intake={intake} />;
}
