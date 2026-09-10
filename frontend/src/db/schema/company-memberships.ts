import { sql } from "drizzle-orm";
import { index, pgEnum, pgPolicy, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { companies } from "./companies";
import { profiles } from "./profiles";

export const companyMemberRole = pgEnum("company_member_role", ["owner", "admin", "recruiter"]);

export const membershipStatus = pgEnum("membership_status", ["active", "invited", "disabled"]);

const ownerRole = sql`ARRAY['owner']::public.company_member_role[]`;

export const companyMemberships = pgTable(
  "company_memberships",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    profileId: uuid()
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: companyMemberRole().notNull(),
    status: membershipStatus().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("company_memberships_company_profile_unique").on(table.companyId, table.profileId),
    index("company_memberships_profile_status_idx").on(table.profileId, table.status),
    index("company_memberships_company_role_status_idx").on(
      table.companyId,
      table.role,
      table.status,
    ),
    pgPolicy("company_memberships_select_own_or_manager", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.profileId} = ${authUid} OR public.has_company_role(${table.companyId}, ARRAY['owner', 'admin']::public.company_member_role[])`,
    }),
    pgPolicy("company_memberships_insert_manager", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`public.has_company_role(${table.companyId}, ${ownerRole}) OR (public.has_company_role(${table.companyId}, ARRAY['admin']::public.company_member_role[]) AND ${table.role} = 'recruiter')`,
    }),
    pgPolicy("company_memberships_update_manager", {
      for: "update",
      to: authenticatedRole,
      using: sql`public.has_company_role(${table.companyId}, ${ownerRole}) OR (public.has_company_role(${table.companyId}, ARRAY['admin']::public.company_member_role[]) AND ${table.role} = 'recruiter')`,
      withCheck: sql`public.has_company_role(${table.companyId}, ${ownerRole}) OR (public.has_company_role(${table.companyId}, ARRAY['admin']::public.company_member_role[]) AND ${table.role} = 'recruiter')`,
    }),
    pgPolicy("company_memberships_delete_manager", {
      for: "delete",
      to: authenticatedRole,
      using: sql`public.has_company_role(${table.companyId}, ${ownerRole}) OR (public.has_company_role(${table.companyId}, ARRAY['admin']::public.company_member_role[]) AND ${table.role} = 'recruiter')`,
    }),
  ],
).enableRLS();
