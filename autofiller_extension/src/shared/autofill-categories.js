// Fields to autofill (KAN-480): the categories the student can switch off in
// Options, as Simplify's settings have them. A category that is off is left
// blank on the form and needs the student (background/engine.js holds its
// answers back; lib-status.js's needsYou counts the rows). Switching one off
// never deletes a saved answer: only the Fill engine's profile for the Plan
// goes without those facts.
//
// Which questions a category answers is the engine's to say, never a list of
// labels here: engine.js plans again without the category's facts, and the
// answers that change are the category's.

/** Where the off categories are kept, in chrome.storage.local: an array of ids. */
export const AUTOFILL_OFF_KEY = "autofill_off";

/**
 * Each category: its id, the words Options and the panel show, and the
 * engine profile's facts it covers (a section, or `section.fact`).
 * @type {{ id: string, label: string, facts: string[] }[]}
 */
export const CATEGORIES = [
  {
    id: "contact",
    label: "Contact info",
    facts: [
      "identity.legal_first_name", "identity.legal_middle_name", "identity.legal_last_name", "identity.preferred_first_name",
      "identity.preferred_last_name", "identity.name_pronunciation", "identity.name_in_native_script", "identity.email", "identity.phone", "links",
    ],
  },
  {
    id: "location",
    label: "Location",
    facts: [
      "identity.current_location", "identity.home_address", "identity.summer_2027_location",
      "logistics.location_preferences", "logistics.willing_to_relocate_for_summer", "logistics.relocation_limits", "logistics.miles_from",
    ],
  },
  { id: "documents", label: "Documents", facts: ["files"] },
  { id: "education", label: "Education", facts: ["education"] },
  { id: "experience", label: "Experience", facts: ["experience_facts", "identity.current_company"] },
  { id: "demographics", label: "Demographics", facts: ["voluntary_self_id", "identity.pronouns"] },
  { id: "work_authorization", label: "Work authorization", facts: ["work_authorization"] },
];

/** The engine profile without one category's facts (a copy; the profile given is left as it is). */
export function withoutCategory(profile, id) {
  const category = CATEGORIES.find((c) => c.id === id);
  if (!category) return profile;
  const copy = { ...profile };
  for (const fact of category.facts) {
    const [section, name] = fact.split(".");
    if (!name) delete copy[section];
    else if (copy[section] && typeof copy[section] === "object") {
      copy[section] = { ...copy[section] };
      delete copy[section][name];
    }
  }
  return copy;
}
