import { ArrowLeftIcon, SearchIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * What a company screen shows when it calls notFound() (KAN-561): a job
 * posting that is not this company's, or no longer exists. Inside the
 * shell, with a way back to the Dashboard, worded as (seeker)/not-found.tsx
 * is, so every 404 reads alike. A URL that matches no route at all is the
 * root not-found's.
 */
export default function CompanyNotFound() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-4 py-6 sm:px-8 lg:px-12">
      <EmptyState
        Icon={SearchIcon}
        title="We Couldn't Find That Page"
        action={
          <ButtonLink href="/company" variant="secondary" size="sm">
            <ArrowLeftIcon className="size-3.5" />
            Back to Dashboard
          </ButtonLink>
        }
      >
        The link may be broken, or the page may have moved.
      </EmptyState>
    </div>
  );
}
