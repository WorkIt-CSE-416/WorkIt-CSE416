/**
 * What a recruiter's six-second skim punishes, checked as the applicant types,
 * with no model involved: so the builder still coaches when the writing help
 * is down or used up for the day. Each rule is a habit resume guides agree on,
 * and each hint says how to fix it rather than only what is wrong.
 */
const WEAK_OPENERS =
  /^(responsible for|worked on|helped( with)?|assisted( with)?|in charge of|tasked with|duties included)\b/i;
const PASSIVE = /\b(was|were|been|being|is|are)\s+\w+(ed|en)\b/i;
const FIRST_PERSON = /\b(i|me|my|we|our)\b/i;
const MAX_CHARS = 160;

export function bulletHints(bullet: string, wantsNumber: boolean): string[] {
  const text = bullet.trim();
  if (!text) return [];
  const hints: string[] = [];
  const first = text.split(/\s+/)[0] ?? "";
  if (WEAK_OPENERS.test(text)) {
    hints.push("Start with what you did: Built, Led, Cut, Designed.");
  } else if (/ing$/i.test(first)) {
    hints.push("Start with a past-tense verb (Built, not Building).");
  }
  if (PASSIVE.test(text)) hints.push("Say it actively, with you doing it.");
  if (FIRST_PERSON.test(text)) hints.push("Leave out I and my; the resume is already about you.");
  if (text.length > MAX_CHARS) hints.push("Keep it to one or two lines.");
  if (wantsNumber && !/\d/.test(text)) {
    hints.push("A number makes it stronger: how many, how much, how fast.");
  }
  return hints;
}
