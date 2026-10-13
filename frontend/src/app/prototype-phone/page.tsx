"use client";

/**
 * PROTOTYPE (KAN-201), throwaway: three phone layouts of the KAN-195 resume
 * editor on one route, switchable with ?variant=A|B|C. On a desktop screen
 * each one runs inside a 390 x 844 device; on a real phone it fills the
 * screen. Reuses the KAN-195 fixture bank and stand-in page. Lives on a
 * throwaway branch and never merges.
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useEditor } from "../prototype-editor/model";
import { PrototypeSwitcher } from "../prototype-editor/switcher";
import * as A from "./variant-a";
import * as B from "./variant-b";
import * as C from "./variant-c";

const VARIANTS = [
  { key: "A", name: A.NAME, View: A.VariantA },
  { key: "B", name: B.NAME, View: B.VariantB },
  { key: "C", name: C.NAME, View: C.VariantC },
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
    <>
      {/* key: a new variant starts from the same fixture */}
      <Body key={v.key} View={v.View} />
      <PrototypeSwitcher variants={VARIANTS} current={v.key} top />
    </>
  );
}

function Body({ View }: { View: (typeof VARIANTS)[number]["View"] }) {
  return <View editor={useEditor()} />;
}
