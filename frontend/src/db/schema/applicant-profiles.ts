import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { profiles } from "./profiles";

export const applicantProfiles = pgTable(
  "applicant_profiles",
  {
    profileId: uuid()
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    headline: text(),
    location: text(),
    linkedinUrl: text(),
    githubUrl: text(),
    portfolioUrl: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    pgPolicy("applicant_profiles_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.profileId} = ${authUid}`,
    }),
    pgPolicy("applicant_profiles_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${table.profileId} = ${authUid}`,
    }),
    pgPolicy("applicant_profiles_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.profileId} = ${authUid}`,
      withCheck: sql`${table.profileId} = ${authUid}`,
    }),
    pgPolicy("applicant_profiles_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${table.profileId} = ${authUid}`,
    }),
  ],
).enableRLS();
