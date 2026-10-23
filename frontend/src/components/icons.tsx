import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  ArrowSquareOutIcon as ArrowSquareOut,
  ArrowsLeftRightIcon as ArrowsLeftRight,
  BackpackIcon as Backpack,
  BellIcon as Bell,
  BookmarkSimpleIcon as BookmarkSimple,
  BriefcaseIcon as Briefcase,
  BuildingIcon as Building,
  BuildingOfficeIcon as BuildingOffice,
  CalendarBlankIcon as CalendarBlank,
  CaretDownIcon as CaretDown,
  CaretUpDownIcon as CaretUpDown,
  CaretUpIcon as CaretUp,
  CheckIcon as Check,
  ClockIcon as Clock,
  DotsThreeIcon as DotsThree,
  EnvelopeIcon as Envelope,
  FileTextIcon as FileText,
  FunnelSimpleIcon as FunnelSimple,
  GearIcon as Gear,
  GiftIcon as Gift,
  GlobeIcon as Globe,
  GraduationCapIcon as GraduationCap,
  HouseIcon as House,
  IdentificationBadgeIcon as IdentificationBadge,
  IdentificationCardIcon as IdentificationCard,
  InfoIcon as Info,
  ListChecksIcon as ListChecks,
  LockIcon as Lock,
  MagnifyingGlassIcon as MagnifyingGlass,
  MapPinIcon as MapPin,
  MedalIcon as Medal,
  MedalMilitaryIcon as MedalMilitary,
  MoneyIcon as Money,
  PaperPlaneTiltIcon as PaperPlaneTilt,
  PencilSimpleIcon as PencilSimple,
  PersonArmsSpreadIcon as PersonArmsSpread,
  PlusIcon as Plus,
  PushPinIcon as PushPin,
  PushPinSlashIcon as PushPinSlash,
  SealCheckIcon as SealCheck,
  ShieldCheckIcon as ShieldCheck,
  SignOutIcon as SignOut,
  SparkleIcon as Sparkle,
  StarIcon as Star,
  TargetIcon as Target,
  TrashIcon as Trash,
  TrendDownIcon as TrendDown,
  TrendUpIcon as TrendUp,
  UploadSimpleIcon as UploadSimple,
  UserCircleIcon as UserCircle,
  UserIcon as User,
  UsersThreeIcon as UsersThree,
  XIcon as X,
} from "@phosphor-icons/react/ssr";
import {
  ClipboardCheckIcon as ClipboardCheck,
  FileCheckIcon as FileCheck,
  UserTieIcon as UserTie,
} from "@/components/custom-icons";

import type { AutofillAnswers } from "@/lib/autofill-answers";

type IconProps = { className?: string };

/**
 * Icons used by more than one route.
 *
 * Per-route icon sets stay beside their route; a glyph moves here the moment a
 * second route needs it.
 *
 * THEY ARE PHOSPHOR'S (KAN-350), at its regular weight, imported from
 * `@phosphor-icons/react/ssr` so a server component can draw them. They were
 * Lucide's until KAN-350, and hand-drawn before that at a 1.4 stroke on four
 * grids, which put two icon families on every screen. Each export is a thin
 * wrapper that keeps its old name and props, so no call site changed when the
 * drawing did. Lucide went because it reads as the default set of every
 * shadcn app and AI builder.
 *
 * Phosphor marks no glyph aria-hidden on its own, so every wrapper passes it.
 * A filled state takes Phosphor's `weight="fill"`, never a `fill` prop or a
 * `fill-*` class: its glyphs are filled shapes, so either one paints the
 * whole glyph.
 *
 * The three brand marks at the bottom (Google, LinkedIn, the PDF file) stay
 * drawn: they are logos, not glyphs. A glyph Phosphor lacks (RoleIcon's
 * person in a suit, the checked clipboard and file) is drawn in
 * ./custom-icons.tsx, which takes Phosphor's props and weights, never as a
 * bare <svg> here.
 */

/* Chrome ------------------------------------------------------------------ */

/** Scout and every AI action, the one mark for both (KAN-257): the top bar's
 *  launcher, the panel's header, Scout's mark in the chat, Ask Scout, Tailor
 *  My Resume and Read It Again with AI. It was a filled sparkle drawn by hand
 *  in the bar and the panel, beside an outlined one in the chat and on every
 *  AI button, so the assistant wore two marks. Use this, never Phosphor's
 *  `SparkleIcon` directly. */
export function SparkleIcon({ className }: IconProps) {
  return <Sparkle aria-hidden className={className} />;
}

export function SearchIcon({ className }: IconProps) {
  return <MagnifyingGlass aria-hidden className={className} />;
}

export function FilterIcon({ className }: IconProps) {
  return <FunnelSimple aria-hidden className={className} />;
}

/** A filter chip's trailing glyph while it is still a dropdown. */
export function ChevronDownIcon({ className }: IconProps) {
  return <CaretDown aria-hidden className={className} />;
}

/** The same chip's trailing glyph once it has something to remove. */
export function CloseIcon({ className }: IconProps) {
  return <X aria-hidden className={className} />;
}

/** A back link's arrow. */
export function ArrowLeftIcon({ className }: IconProps) {
  return <ArrowLeft aria-hidden className={className} />;
}

export function ArrowRightIcon({ className }: IconProps) {
  return <ArrowRight aria-hidden className={className} />;
}

/** Opens the overflow menu on a card or a column. */
export function EllipsisIcon({ className }: IconProps) {
  return <DotsThree aria-hidden className={className} />;
}

/** A job posting that fits the seeker: the Dashboard's Good Matches. A
 *  target, not SparkleIcon, which marks Scout and AI only (KAN-257). */
export function MatchIcon({ className }: IconProps) {
  return <Target aria-hidden className={className} />;
}

/** Filled is the saved state; the outline is the affordance to save. */
export function BookmarkIcon({ className, filled = false }: IconProps & { filled?: boolean }) {
  return <BookmarkSimple aria-hidden weight={filled ? "fill" : "regular"} className={className} />;
}

/** Edit: the profile pencils, seeker and company. */
export function PencilIcon({ className }: IconProps) {
  return <PencilSimple aria-hidden className={className} />;
}

/** Delta direction on a stat tile. */
export function TrendIcon({ className, down = false }: IconProps & { down?: boolean }) {
  const Glyph = down ? TrendDown : TrendUp;
  return <Glyph aria-hidden className={className} />;
}

/** Add a row: a screening question, a work-history entry. */
export function PlusIcon({ className }: IconProps) {
  return <Plus aria-hidden className={className} />;
}

/** Done: a finished step, a chosen chip, a met requirement. */
export function CheckIcon({ className }: IconProps) {
  return <Check aria-hidden className={className} />;
}

export function ClockIcon({ className }: IconProps) {
  return <Clock aria-hidden className={className} />;
}

/** After a link that leaves WorkIt, such as Apply on an employer's own site. */
export function ExternalLinkIcon({ className }: IconProps) {
  return <ArrowSquareOut aria-hidden className={className} />;
}

/* App shell ---------------------------------------------------------------- */

/** The top bar and its account menu, shared by both shells. */
export function BellIcon({ className }: IconProps) {
  return <Bell aria-hidden className={className} />;
}

/** The account menu's Profile item. */
export function UserIcon({ className }: IconProps) {
  return <User aria-hidden className={className} />;
}

export function GearIcon({ className }: IconProps) {
  return <Gear aria-hidden className={className} />;
}

/** The account menu's Sign out row. */
export function SignOutIcon({ className }: IconProps) {
  return <SignOut aria-hidden className={className} />;
}

/* Facts about a job, and the stages of a search ---------------------------
 * The listing card on /jobs and /search, the job page and the composer's
 * preview all describe a job with these, so each fact keeps one glyph wherever it is printed:
 * location PinIcon, job type BriefcaseIcon, salary CoinIcon, work style
 * workStyleIcon(), level LevelIcon, years required (and the job page's start
 * date) CalendarIcon. */

export function CoinIcon({ className }: IconProps) {
  return <Money aria-hidden className={className} />;
}

export function PinIcon({ className }: IconProps) {
  return <MapPin aria-hidden className={className} />;
}

export function BriefcaseIcon({ className }: IconProps) {
  return <Briefcase aria-hidden className={className} />;
}

/** The Offer stage (see (seeker)/stage-colors.ts), not a job's level. */
export function AwardIcon({ className }: IconProps) {
  return <Medal aria-hidden className={className} />;
}

/** Experience level: a mortarboard, which reads for "Internship" as well as
 *  "Senior", where the Offer stage's prize rosette did not. */
export function LevelIcon({ className }: IconProps) {
  return <GraduationCap aria-hidden className={className} />;
}

export function StudentIcon({ className }: IconProps) {
  return <Backpack aria-hidden className={className} />;
}

export function ExperiencedIcon({ className }: IconProps) {
  return <SealCheck aria-hidden className={className} />;
}

/* Keyed as WORK_STYLE_ICON is, so the filter's "new_grad" and a label's
 * "New Grad" find the same glyph. */
const LEVEL_ICON = {
  student: StudentIcon,
  newgrad: LevelIcon,
  experienced: ExperiencedIcon,
} as const;

/**
 * One experience level's glyph, for a list that tells the levels apart (the
 * Experience filter's options, KAN-252): a backpack for a student, the
 * mortarboard for a new grad, a check badge for someone experienced. A fact
 * that names one level, as the job card does, still draws LevelIcon. An
 * unknown or missing level falls back to the mortarboard.
 */
export function levelIcon(level: string | null) {
  const key = level?.toLowerCase().replace(/[^a-z]/g, "");
  return LEVEL_ICON[key as keyof typeof LEVEL_ICON] ?? LevelIcon;
}

export function OnSiteIcon({ className }: IconProps) {
  return <BuildingOffice aria-hidden className={className} />;
}

export function RemoteIcon({ className }: IconProps) {
  return <House aria-hidden className={className} />;
}

export function HybridIcon({ className }: IconProps) {
  return <ArrowsLeftRight aria-hidden className={className} />;
}

/* Keyed by the label with its case and punctuation stripped, because several
 * spellings occur: the feed prints "On-Site", job-detail/data.ts writes
 * "Onsite", and the composer keeps labels of its own. A recased label still
 * finds its glyph rather than silently falling back to the building. */
const WORK_STYLE_ICON = {
  onsite: OnSiteIcon,
  remote: RemoteIcon,
  hybrid: HybridIcon,
} as const;

/**
 * Work style's glyph, picked by its display label: a building, a house, or two
 * arrows for a week split between them. A function returning the icon rather
 * than an icon taking `workStyle`, because <Fact> and the facts tables take an
 * icon component. An unknown or missing label falls back to the building.
 */
export function workStyleIcon(workStyle: string | null) {
  const key = workStyle?.toLowerCase().replace(/[^a-z]/g, "");
  return WORK_STYLE_ICON[key as keyof typeof WORK_STYLE_ICON] ?? OnSiteIcon;
}

/** Visa sponsorship: a globe, the job open to someone from anywhere. The
 *  Visa filter's, and the job card's once it shows sponsorship (KAN-168). */
export function VisaIcon({ className }: IconProps) {
  return <Globe aria-hidden className={className} />;
}

/** A role, the job a person does: someone in a suit and tie (KAN-252; it
 *  was shapes, which read as nothing). The Role filter's and onboarding's;
 *  the job card doesn't print the fact. */
export function RoleIcon({ className }: IconProps) {
  return <UserTie aria-hidden className={className} />;
}

/* A job description's sections, beside their fixed headings on the job
 * posting page (KAN-229's Overview, Responsibilities, Requirements, Preferred
 * Qualifications and Details; Pay draws CoinIcon, the salary fact's), then the
 * extras folded under them: Benefits, How to Apply and About the Company. */

export function BenefitsIcon({ className }: IconProps) {
  return <Gift aria-hidden className={className} />;
}

export function ApplyIcon({ className }: IconProps) {
  return <PaperPlaneTilt aria-hidden className={className} />;
}

/** A plain building, not On-Site's BuildingOffice, so the two never read as one fact. */
export function CompanyIcon({ className }: IconProps) {
  return <Building aria-hidden className={className} />;
}

export function OverviewIcon({ className }: IconProps) {
  return <FileText aria-hidden className={className} />;
}

export function ResponsibilitiesIcon({ className }: IconProps) {
  return <ListChecks aria-hidden className={className} />;
}

export function RequirementsIcon({ className }: IconProps) {
  return <ClipboardCheck aria-hidden className={className} />;
}

export function PreferredIcon({ className }: IconProps) {
  return <Star aria-hidden className={className} />;
}

export function DetailsIcon({ className }: IconProps) {
  return <Info aria-hidden className={className} />;
}

export function CalendarIcon({ className }: IconProps) {
  return <CalendarBlank aria-hidden className={className} />;
}

export function MailIcon({ className }: IconProps) {
  return <Envelope aria-hidden className={className} />;
}

/* Auth --------------------------------------------------------------------- */

export function LockIcon({ className }: IconProps) {
  return <Lock aria-hidden className={className} />;
}

/* Resume upload ------------------------------------------------------------ */

export function UploadIcon({ className }: IconProps) {
  return <UploadSimple aria-hidden className={className} />;
}

export function FileIcon({ className }: IconProps) {
  return <FileText aria-hidden className={className} />;
}

export function TrashIcon({ className }: IconProps) {
  return <Trash aria-hidden className={className} />;
}

/* Brand marks ---------------------------------------------------------------
 * The two OAuth providers' own logos, in their own colours. Unlike every other
 * icon in this file these do not take `currentColor` — a brand mark recoloured
 * to the surrounding text is no longer the brand mark, and both companies'
 * guidelines require the official colours on a light background, which is what
 * an auth card gives them. So the fills are literal hex rather than tokens:
 * they must not follow a palette change.
 *
 * Both are drawn to fill their viewBox, so a single `size-*` at the call site
 * makes them optically equal. */

/** Google's four-colour "G". */
export function GoogleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.55 10.78l7.98-6.19Z"
      />
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.55 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
      />
    </svg>
  );
}

/**
 * LinkedIn's boxed "in".
 *
 * The box is its own rect and the letters are painted white over it, rather
 * than the one-path version in circulation that knocks them out by winding
 * rule — that path renders solid the moment anything applies `fill-rule:
 * evenodd`, and this cannot.
 */
export function LinkedInIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <rect width="24" height="24" rx="2.2" fill="#0A66C2" />
      <path
        fill="#fff"
        d="M7.12 20.45H3.56V9h3.56v11.45ZM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13Zm15.11 13.02h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29Z"
      />
    </svg>
  );
}

/** A PDF file: the one glyph the resume mockup renders in colour rather than
 *  the surrounding ink, so it stays drawn. */
export function PdfIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="#b21919"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M11.4 1.7H5.2a1.9 1.9 0 0 0-1.9 1.9v12.8a1.9 1.9 0 0 0 1.9 1.9h9.6a1.9 1.9 0 0 0 1.9-1.9V7.1Z" />
      <path d="M11.4 1.7v5.4h5.4" />
      <path d="M6.6 11.9v3.4M6.6 11.9h1a1 1 0 0 1 0 2h-1M13.4 11.9h-1.8v3.4M11.6 13.6h1.5" />
      <path d="M8.9 15.3v-3.4h.8a1.7 1.7 0 0 1 0 3.4Z" />
    </svg>
  );
}

/**
 * Sort state on a column heading: the company tables and the seeker's
 * Applications list.
 *
 * Three states, three glyphs from one family. Unsorted shows both chevrons, so
 * a column that can be sorted looks different from one that cannot even
 * before anyone clicks it; sorted shows only the direction in force. Colour
 * changes too (the caller tints it brand once active), but the shape carries
 * the state on its own, which is what keeps it readable where colour is not.
 */
export function SortIcon({ className, direction }: IconProps & { direction?: "asc" | "desc" }) {
  const Glyph = direction === "asc" ? CaretUp : direction === "desc" ? CaretDown : CaretUpDown;
  return <Glyph aria-hidden className={className} />;
}

/** Work authorization: a checked document. */
export function AuthorizationIcon({ className }: IconProps) {
  return <FileCheck aria-hidden className={className} />;
}

/** Citizenship and visa status: an ID card. */
export function CitizenshipIcon({ className }: IconProps) {
  return <IdentificationCard aria-hidden className={className} />;
}

/** Security clearance: a checked shield. */
export function ClearanceIcon({ className }: IconProps) {
  return <ShieldCheck aria-hidden className={className} />;
}

/** Gender: a person. */
export function GenderIcon({ className }: IconProps) {
  return <UserCircle aria-hidden className={className} />;
}

/** Hispanic or Latino: a contact card. */
export function HispanicLatinoIcon({ className }: IconProps) {
  return <IdentificationBadge aria-hidden className={className} />;
}

/** Race/Ethnicity: a group of people. */
export function RaceIcon({ className }: IconProps) {
  return <UsersThree aria-hidden className={className} />;
}

/** Veteran status: a medal. */
export function VeteranIcon({ className }: IconProps) {
  return <MedalMilitary aria-hidden className={className} />;
}

/** Disability: the accessibility figure. */
export function DisabilityIcon({ className }: IconProps) {
  return <PersonArmsSpread aria-hidden className={className} />;
}

const ANSWER_ICON: Record<keyof AutofillAnswers, typeof AuthorizationIcon> = {
  work_authorized_us: AuthorizationIcon,
  needs_sponsorship: VisaIcon,
  work_authorization_status: CitizenshipIcon,
  security_clearance: ClearanceIcon,
  gender: GenderIcon,
  hispanic_latino: HispanicLatinoIcon,
  race: RaceIcon,
  veteran_status: VeteranIcon,
  disability_status: DisabilityIcon,
};

/** An application question's glyph, by its key in the answer bank
 *  (lib/autofill-answers): onboarding's Profile step and My Profile's
 *  Application Questions draw the same one. Moved here from onboarding when
 *  My Profile became the second route to want them (KAN-269). */
export function answerIcon(key: keyof AutofillAnswers) {
  return ANSWER_ICON[key];
}

/** The sidebar's pin (KAN-300, components/hover-sidebar.tsx): a pin to pin
 *  the panel open, crossed out to unpin it. Not PinIcon, which is a place. */
export function SidebarPinIcon({ pinned, className }: IconProps & { pinned: boolean }) {
  const Glyph = pinned ? PushPinSlash : PushPin;
  return <Glyph aria-hidden className={className} />;
}
