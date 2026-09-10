CREATE TYPE "public"."company_size_range" AS ENUM('1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+');--> statement-breakpoint
CREATE TYPE "public"."company_member_role" AS ENUM('owner', 'admin', 'recruiter');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'invited', 'disabled');--> statement-breakpoint
CREATE TABLE "applicant_profiles" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"headline" text,
	"location" text,
	"linkedin_url" text,
	"github_url" text,
	"portfolio_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applicant_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "autofill_answers" (
	"applicant_profile_id" uuid PRIMARY KEY NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autofill_answers_answers_object_check" CHECK (jsonb_typeof("autofill_answers"."answers") = 'object')
);
--> statement-breakpoint
ALTER TABLE "autofill_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"website_url" text,
	"contact_email" text,
	"contact_phone" text,
	"logo_url" text,
	"description" text,
	"industry" text,
	"size_range" "company_size_range",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"role" "company_member_role" NOT NULL,
	"status" "membership_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_memberships_company_profile_unique" UNIQUE("company_id","profile_id")
);
--> statement-breakpoint
ALTER TABLE "company_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone_number" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "applicant_profiles" ADD CONSTRAINT "applicant_profiles_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autofill_answers" ADD CONSTRAINT "autofill_answers_applicant_profile_id_applicant_profiles_profile_id_fk" FOREIGN KEY ("applicant_profile_id") REFERENCES "public"."applicant_profiles"("profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_memberships_profile_status_idx" ON "company_memberships" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "company_memberships_company_role_status_idx" ON "company_memberships" USING btree ("company_id","role","status");--> statement-breakpoint
CREATE FUNCTION "public"."workit_set_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."workit_set_updated_at"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "applicant_profiles_set_updated_at"
BEFORE UPDATE ON "public"."applicant_profiles"
FOR EACH ROW EXECUTE FUNCTION "public"."workit_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "autofill_answers_set_updated_at"
BEFORE UPDATE ON "public"."autofill_answers"
FOR EACH ROW EXECUTE FUNCTION "public"."workit_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "companies_set_updated_at"
BEFORE UPDATE ON "public"."companies"
FOR EACH ROW EXECUTE FUNCTION "public"."workit_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "company_memberships_set_updated_at"
BEFORE UPDATE ON "public"."company_memberships"
FOR EACH ROW EXECUTE FUNCTION "public"."workit_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "profiles_set_updated_at"
BEFORE UPDATE ON "public"."profiles"
FOR EACH ROW EXECUTE FUNCTION "public"."workit_set_updated_at"();--> statement-breakpoint
CREATE FUNCTION "public"."has_company_role"(
	company_id uuid,
	roles "public"."company_member_role"[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM "public"."company_memberships" AS membership
		WHERE membership.company_id = $1
			AND membership.profile_id = auth.uid()
			AND membership.status = 'active'
			AND membership.role = ANY($2)
	);
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."has_company_role"(uuid, "public"."company_member_role"[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."has_company_role"(uuid, "public"."company_member_role"[]) TO "authenticated";--> statement-breakpoint
CREATE FUNCTION "public"."workit_handle_new_user"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
	IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
		RAISE EXCEPTION 'WorkIt requires an email address';
	END IF;

	INSERT INTO "public"."profiles" (
		id,
		email,
		full_name,
		phone_number,
		avatar_url
	)
	VALUES (
		NEW.id,
		NEW.email,
		COALESCE(
			NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
			NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
			NULLIF(split_part(NEW.email, '@', 1), ''),
			'User'
		),
		COALESCE(
			NULLIF(btrim(NEW.phone), ''),
			NULLIF(btrim(NEW.raw_user_meta_data ->> 'phone_number'), '')
		),
		NULLIF(btrim(NEW.raw_user_meta_data ->> 'avatar_url'), '')
	)
	ON CONFLICT (id) DO NOTHING;

	RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."workit_handle_new_user"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "workit_on_auth_user_created"
AFTER INSERT ON "auth"."users"
FOR EACH ROW EXECUTE FUNCTION "public"."workit_handle_new_user"();--> statement-breakpoint
CREATE FUNCTION "public"."workit_sync_profile_email"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
	IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
		RAISE EXCEPTION 'WorkIt requires an email address';
	END IF;

	UPDATE "public"."profiles"
	SET email = NEW.email
	WHERE id = NEW.id;

	RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."workit_sync_profile_email"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "workit_on_auth_user_email_updated"
AFTER UPDATE OF email ON "auth"."users"
FOR EACH ROW
WHEN (OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION "public"."workit_sync_profile_email"();--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "auth"."users"
		WHERE email IS NULL OR btrim(email) = ''
	) THEN
		RAISE EXCEPTION 'Cannot backfill WorkIt profiles: auth user without email';
	END IF;
END;
$$;--> statement-breakpoint
INSERT INTO "public"."profiles" (
	id,
	email,
	full_name,
	phone_number,
	avatar_url,
	created_at,
	updated_at
)
SELECT
	user_account.id,
	user_account.email,
	COALESCE(
		NULLIF(btrim(user_account.raw_user_meta_data ->> 'full_name'), ''),
		NULLIF(btrim(user_account.raw_user_meta_data ->> 'name'), ''),
		NULLIF(split_part(user_account.email, '@', 1), ''),
		'User'
	),
	COALESCE(
		NULLIF(btrim(user_account.phone), ''),
		NULLIF(btrim(user_account.raw_user_meta_data ->> 'phone_number'), '')
	),
	NULLIF(btrim(user_account.raw_user_meta_data ->> 'avatar_url'), ''),
	user_account.created_at,
	COALESCE(user_account.updated_at, user_account.created_at)
FROM "auth"."users" AS user_account
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
CREATE FUNCTION "public"."create_company"(name text, slug text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	caller_id uuid := auth.uid();
	new_company_id uuid;
BEGIN
	IF caller_id IS NULL THEN
		RAISE EXCEPTION 'Authentication required';
	END IF;

	IF NULLIF(btrim($1), '') IS NULL THEN
		RAISE EXCEPTION 'Company name is required';
	END IF;

	IF NULLIF(btrim($2), '') IS NULL THEN
		RAISE EXCEPTION 'Company slug is required';
	END IF;

	INSERT INTO "public"."companies" (name, slug)
	VALUES (btrim($1), btrim($2))
	RETURNING id INTO new_company_id;

	INSERT INTO "public"."company_memberships" (
		company_id,
		profile_id,
		role,
		status
	)
	VALUES (new_company_id, caller_id, 'owner', 'active');

	RETURN new_company_id;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."create_company"(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."create_company"(text, text) TO "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE
	"public"."profiles",
	"public"."applicant_profiles",
	"public"."autofill_answers",
	"public"."companies",
	"public"."company_memberships"
FROM PUBLIC, "anon", "authenticated";--> statement-breakpoint
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";--> statement-breakpoint
GRANT UPDATE (full_name, phone_number, avatar_url) ON TABLE "public"."profiles" TO "authenticated";--> statement-breakpoint
GRANT SELECT, DELETE ON TABLE "public"."applicant_profiles" TO "authenticated";--> statement-breakpoint
GRANT INSERT (profile_id, headline, location, linkedin_url, github_url, portfolio_url) ON TABLE "public"."applicant_profiles" TO "authenticated";--> statement-breakpoint
GRANT UPDATE (headline, location, linkedin_url, github_url, portfolio_url) ON TABLE "public"."applicant_profiles" TO "authenticated";--> statement-breakpoint
GRANT SELECT, DELETE ON TABLE "public"."autofill_answers" TO "authenticated";--> statement-breakpoint
GRANT INSERT (applicant_profile_id, answers) ON TABLE "public"."autofill_answers" TO "authenticated";--> statement-breakpoint
GRANT UPDATE (answers) ON TABLE "public"."autofill_answers" TO "authenticated";--> statement-breakpoint
GRANT SELECT ON TABLE "public"."companies" TO "anon", "authenticated";--> statement-breakpoint
GRANT UPDATE (name, slug, website_url, contact_email, contact_phone, logo_url, description, industry, size_range) ON TABLE "public"."companies" TO "authenticated";--> statement-breakpoint
GRANT DELETE ON TABLE "public"."companies" TO "authenticated";--> statement-breakpoint
GRANT SELECT, DELETE ON TABLE "public"."company_memberships" TO "authenticated";--> statement-breakpoint
GRANT INSERT (company_id, profile_id, role, status) ON TABLE "public"."company_memberships" TO "authenticated";--> statement-breakpoint
GRANT UPDATE (role, status) ON TABLE "public"."company_memberships" TO "authenticated";--> statement-breakpoint
GRANT ALL ON TABLE
	"public"."profiles",
	"public"."applicant_profiles",
	"public"."autofill_answers",
	"public"."companies",
	"public"."company_memberships"
TO "service_role";--> statement-breakpoint
CREATE POLICY "applicant_profiles_select_own" ON "applicant_profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("applicant_profiles"."profile_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "applicant_profiles_insert_own" ON "applicant_profiles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("applicant_profiles"."profile_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "applicant_profiles_update_own" ON "applicant_profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("applicant_profiles"."profile_id" = (select auth.uid())) WITH CHECK ("applicant_profiles"."profile_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "applicant_profiles_delete_own" ON "applicant_profiles" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("applicant_profiles"."profile_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "autofill_answers_select_own" ON "autofill_answers" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("autofill_answers"."applicant_profile_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "autofill_answers_insert_own" ON "autofill_answers" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("autofill_answers"."applicant_profile_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "autofill_answers_update_own" ON "autofill_answers" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("autofill_answers"."applicant_profile_id" = (select auth.uid())) WITH CHECK ("autofill_answers"."applicant_profile_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "autofill_answers_delete_own" ON "autofill_answers" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("autofill_answers"."applicant_profile_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "companies_select_public" ON "companies" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "companies_update_owner_admin" ON "companies" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (public.has_company_role("companies"."id", ARRAY['owner', 'admin']::public.company_member_role[])) WITH CHECK (public.has_company_role("companies"."id", ARRAY['owner', 'admin']::public.company_member_role[]));--> statement-breakpoint
CREATE POLICY "companies_delete_owner" ON "companies" AS PERMISSIVE FOR DELETE TO "authenticated" USING (public.has_company_role("companies"."id", ARRAY['owner']::public.company_member_role[]));--> statement-breakpoint
CREATE POLICY "company_memberships_select_own_or_manager" ON "company_memberships" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("company_memberships"."profile_id" = (select auth.uid()) OR public.has_company_role("company_memberships"."company_id", ARRAY['owner', 'admin']::public.company_member_role[]));--> statement-breakpoint
CREATE POLICY "company_memberships_insert_manager" ON "company_memberships" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.has_company_role("company_memberships"."company_id", ARRAY['owner']::public.company_member_role[]) OR (public.has_company_role("company_memberships"."company_id", ARRAY['admin']::public.company_member_role[]) AND "company_memberships"."role" = 'recruiter'));--> statement-breakpoint
CREATE POLICY "company_memberships_update_manager" ON "company_memberships" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (public.has_company_role("company_memberships"."company_id", ARRAY['owner']::public.company_member_role[]) OR (public.has_company_role("company_memberships"."company_id", ARRAY['admin']::public.company_member_role[]) AND "company_memberships"."role" = 'recruiter')) WITH CHECK (public.has_company_role("company_memberships"."company_id", ARRAY['owner']::public.company_member_role[]) OR (public.has_company_role("company_memberships"."company_id", ARRAY['admin']::public.company_member_role[]) AND "company_memberships"."role" = 'recruiter'));--> statement-breakpoint
CREATE POLICY "company_memberships_delete_manager" ON "company_memberships" AS PERMISSIVE FOR DELETE TO "authenticated" USING (public.has_company_role("company_memberships"."company_id", ARRAY['owner']::public.company_member_role[]) OR (public.has_company_role("company_memberships"."company_id", ARRAY['admin']::public.company_member_role[]) AND "company_memberships"."role" = 'recruiter'));--> statement-breakpoint
CREATE POLICY "profiles_select_own" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("profiles"."id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profiles_update_own" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("profiles"."id" = (select auth.uid())) WITH CHECK ("profiles"."id" = (select auth.uid()));
