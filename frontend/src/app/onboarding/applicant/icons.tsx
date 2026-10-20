import { Accessibility, FileCheck2, IdCard, Medal, ShieldCheck, UserRound } from "lucide-react";

type IconProps = { className?: string };

/**
 * Glyphs onboarding's Profile step needs and no other route does (KAN-283).
 *
 * Lucide's, as thin wrappers, on the same terms as src/components/icons.tsx.
 * They move there the moment a second route wants them (My Profile, KAN-273).
 */

/** Work authorization: a checked document. */
export function AuthorizationIcon({ className }: IconProps) {
  return <FileCheck2 aria-hidden className={className} />;
}

/** Citizenship and visa status: an ID card. */
export function StatusIcon({ className }: IconProps) {
  return <IdCard aria-hidden className={className} />;
}

/** Security clearance: a checked shield. */
export function ClearanceIcon({ className }: IconProps) {
  return <ShieldCheck aria-hidden className={className} />;
}

/** Gender: a person. */
export function GenderIcon({ className }: IconProps) {
  return <UserRound aria-hidden className={className} />;
}

/** Veteran status: a medal. */
export function VeteranIcon({ className }: IconProps) {
  return <Medal aria-hidden className={className} />;
}

/** Disability: the accessibility figure. */
export function DisabilityIcon({ className }: IconProps) {
  return <Accessibility aria-hidden className={className} />;
}
