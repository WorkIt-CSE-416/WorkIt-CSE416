"use client";

/**
 * PROTOTYPE (KAN-195), throwaway: five layouts of the built-resume editor on
 * one route, switchable with ?variant=A|B|C|D|E. Fixture bank (model.ts); the
 * PDF is an HTML stand-in that lags each edit by one fake render. Sits
 * outside the seeker shell so it needs no sign-in. Lives on a throwaway
 * branch and never merges.
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../(seeker)/gutter";
import { useEditor } from "./model";
import { PrototypeSwitcher } from "./switcher";
import * as A from "./variant-a";
import * as B from "./variant-b";
import * as C from "./variant-c";
import * as D from "./variant-d";
import * as E from "./variant-e";

const VARIANTS = [
  { key: "A", name: A.NAME, View: A.VariantA },
  { key: "B", name: B.NAME, View: B.VariantB },
  { key: "C", name: C.NAME, View: C.VariantC },
  { key: "D", name: D.NAME, View: D.VariantD },
  { key: "E", name: E.NAME, View: E.VariantE },
];

export default function Page() {
  return (
    <Suspense>
      <Prototype />
    </Suspense>
  );
}

function Prototype() {
  const current = useSearchParams().get("variant") ?? "A";
  const v = VARIANTS.find((x) => x.key === current) ?? VARIANTS[0];

  return (
    <div className="bg-app @container/main min-h-dvh">
      <div className={cn("max-w-app mx-auto w-full flex-1 py-6 pb-24", SEEKER_GUTTER)}>
        <h1 className="text-heading text-ink">Software Engineering · Base Resume</h1>
        <p className="text-body text-ink-meta mt-1 mb-5">
          Choose what shows and in what order. Your experience bank keeps the text.
        </p>
        {/* key: a new variant starts from the same fixture */}
        <Body key={v.key} View={v.View} />
        <PrototypeSwitcher variants={VARIANTS} current={v.key} />
      </div>
    </div>
  );
}

function Body({ View }: { View: (typeof VARIANTS)[number]["View"] }) {
  return <View editor={useEditor()} />;
}
