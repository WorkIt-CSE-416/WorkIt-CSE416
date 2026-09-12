import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { anonRole, authenticatedRole } from "drizzle-orm/supabase";

export const companySizeRange = pgEnum("company_size_range", [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001+",
]);

export const companies = pgTable(
  "companies",
  {
    id: uuid().defaultRandom().primaryKey(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    websiteUrl: text(),
    contactEmail: text(),
    contactPhone: text(),
    logoUrl: text(),
    description: text(),
    industry: text(),
    sizeRange: companySizeRange(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    pgPolicy("companies_select_public", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`true`,
    }),
    pgPolicy("companies_update_owner_admin", {
      for: "update",
      to: authenticatedRole,
      using: sql`public.has_company_role(${table.id}, ARRAY['owner', 'admin']::public.company_member_role[])`,
      withCheck: sql`public.has_company_role(${table.id}, ARRAY['owner', 'admin']::public.company_member_role[])`,
    }),
    pgPolicy("companies_delete_owner", {
      for: "delete",
      to: authenticatedRole,
      using: sql`public.has_company_role(${table.id}, ARRAY['owner']::public.company_member_role[])`,
    }),
  ],
).enableRLS();
