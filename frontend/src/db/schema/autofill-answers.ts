import { sql } from "drizzle-orm";
import { check, jsonb, pgPolicy, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { applicantProfiles } from "./applicant-profiles";

type AutofillAnswerValue = string | number | boolean | string[] | null;

export type AutofillAnswerBank = Record<
  string,
  { question_text: string; answer: AutofillAnswerValue }
>;

export const autofillAnswers = pgTable(
  "autofill_answers",
  {
    applicantProfileId: uuid()
      .primaryKey()
      .references(() => applicantProfiles.profileId, { onDelete: "cascade" }),
    answers: jsonb().$type<AutofillAnswerBank>().default({}).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("autofill_answers_answers_object_check", sql`jsonb_typeof(${table.answers}) = 'object'`),
    pgPolicy("autofill_answers_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.applicantProfileId} = ${authUid}`,
    }),
    pgPolicy("autofill_answers_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${table.applicantProfileId} = ${authUid}`,
    }),
    pgPolicy("autofill_answers_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.applicantProfileId} = ${authUid}`,
      withCheck: sql`${table.applicantProfileId} = ${authUid}`,
    }),
    pgPolicy("autofill_answers_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${table.applicantProfileId} = ${authUid}`,
    }),
  ],
).enableRLS();

export function setAutofillAnswer(key: string, value: AutofillAnswerBank[string]) {
  return sql`jsonb_set(${autofillAnswers.answers}, ARRAY[${key}], ${JSON.stringify(value)}::jsonb, true)`;
}
