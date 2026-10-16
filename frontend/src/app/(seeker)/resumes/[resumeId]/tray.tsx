"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Bank } from "@/lib/bank-actions";
import type { Choices, ChoicesUpdate } from "@/lib/built-resume-actions";

import { putBack, tray, type TrayItem } from "./model";

/**
 * "Not on This Resume" (KAN-218, user story 65): bank entries this resume
 * does not show (hidden, or added to the bank after Generate), hidden
 * bullets and hidden skills. One click puts an item back; an entry comes
 * back at the end of its section with its bullets.
 */
export function Tray({
  bank,
  choices,
  onPutBack,
}: {
  bank: Bank;
  choices: Choices;
  onPutBack: (changes: ChoicesUpdate) => void;
}) {
  const items = tray(bank, choices);
  if (items.length === 0) return null;
  return (
    <section className="bg-brand-tint/40 ring-border-subtle rounded-2xl p-4 ring-1">
      <h2 className="text-label text-ink mb-2 font-semibold">Not on This Resume</h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={`${item.kind}.${id(item)}`} className="max-w-full">
            <Button
              variant="secondary"
              size="sm"
              className="max-w-full"
              onClick={() => onPutBack(putBack(item))}
            >
              <Plus />
              <span className="truncate">{label(item)}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function id(item: TrayItem) {
  return item.kind === "entry"
    ? item.entry.id
    : item.kind === "bullet"
      ? item.bullet.id
      : item.skill.id;
}

function label(item: TrayItem) {
  if (item.kind === "entry") return item.entry.title;
  if (item.kind === "skill") return `Skill: ${item.skill.name}`;
  return `${item.entry.title}: ${item.text}`;
}
