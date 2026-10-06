import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Award,
  Banknote,
  Bell,
  Bookmark,
  BriefcaseBusiness,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Ellipsis,
  ExternalLink,
  GraduationCap,
  House,
  ListFilter,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Monitor,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  User,
  X,
} from "lucide-react";

type IconProps = { className?: string };

/**
 * Icons used by more than one route.
 *
 * Per-route icon sets stay beside their route; a glyph moves here the moment a
 * second route needs it.
 *
 * THEY ARE LUCIDE'S, the set the sidebar, its toggle and shadcn's own
 * components already draw. These used to be hand-drawn at a 1.4 stroke on 12-,
 * 14-, 16- and 18-unit grids, which put two icon families on every screen: a
 * Lucide toggle beside a house bell in the top bar, and strokes from 0.88px to
 * 2px on the Dashboard. Each export is now a thin wrapper that keeps its old
 * name and props, so no call site changed when the drawing did.
 *
 * Lucide's default stroke is kept (no strokeWidth, no absoluteStrokeWidth), so
 * these weigh exactly what the sidebar's do at the same size. Lucide also marks
 * a glyph aria-hidden on its own; it is passed here anyway so the rule is
 * visible where the icons are defined.
 *
 * The three brand marks at the bottom (Google, LinkedIn, the PDF file) stay
 * drawn: they are logos, not glyphs, and Lucide does not have them.
 */

/* Chrome ------------------------------------------------------------------ */

export function SearchIcon({ className }: IconProps) {
  return <Search aria-hidden className={className} />;
}

export function FilterIcon({ className }: IconProps) {
  return <ListFilter aria-hidden className={className} />;
}

/** A filter chip's trailing glyph while it is still a dropdown. */
export function ChevronDownIcon({ className }: IconProps) {
  return <ChevronDown aria-hidden className={className} />;
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
  return <Ellipsis aria-hidden className={className} />;
}

/** Filled is the saved state; the outline is the affordance to save. */
export function BookmarkIcon({ className, filled = false }: IconProps & { filled?: boolean }) {
  return <Bookmark aria-hidden fill={filled ? "currentColor" : "none"} className={className} />;
}

/** Edit: the profile pencils, seeker and company. */
export function PencilIcon({ className }: IconProps) {
  return <Pencil aria-hidden className={className} />;
}

/** Delta direction on a stat tile. */
export function TrendIcon({ className, down = false }: IconProps & { down?: boolean }) {
  const Glyph = down ? TrendingDown : TrendingUp;
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
  return <ExternalLink aria-hidden className={className} />;
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
  return <Settings aria-hidden className={className} />;
}

/** The account menu's Sign out row. */
export function SignOutIcon({ className }: IconProps) {
  return <LogOut aria-hidden className={className} />;
}

/* Facts about a job, and the stages of a search ---------------------------
 * The job card on /jobs, the job page and the /search detail all describe a
 * job with these, so each fact keeps one glyph wherever it is printed:
 * location PinIcon, job type BriefcaseIcon, salary CoinIcon, work style
 * workStyleIcon(), level LevelIcon, years required (and the job page's start
 * date) CalendarIcon. */

export function CoinIcon({ className }: IconProps) {
  return <Banknote aria-hidden className={className} />;
}

export function PinIcon({ className }: IconProps) {
  return <MapPin aria-hidden className={className} />;
}

export function BriefcaseIcon({ className }: IconProps) {
  return <BriefcaseBusiness aria-hidden className={className} />;
}

/** A company tile's glyph. A job's work style draws workStyleIcon() instead. */
export function MonitorIcon({ className }: IconProps) {
  return <Monitor aria-hidden className={className} />;
}

/** The Offer stage (see (seeker)/stage-colors.ts), not a job's level. */
export function AwardIcon({ className }: IconProps) {
  return <Award aria-hidden className={className} />;
}

/** Experience level: a mortarboard, which reads for "Internship" as well as
 *  "Senior", where the Offer stage's prize rosette did not. */
export function LevelIcon({ className }: IconProps) {
  return <GraduationCap aria-hidden className={className} />;
}

export function OnSiteIcon({ className }: IconProps) {
  return <Building2 aria-hidden className={className} />;
}

export function RemoteIcon({ className }: IconProps) {
  return <House aria-hidden className={className} />;
}

export function HybridIcon({ className }: IconProps) {
  return <ArrowLeftRight aria-hidden className={className} />;
}

/* Both spellings occur: the feed and the composer print "On-site", while
 * job-detail/data.ts writes "Onsite". */
const WORK_STYLE_ICON = {
  "On-site": OnSiteIcon,
  Onsite: OnSiteIcon,
  Remote: RemoteIcon,
  Hybrid: HybridIcon,
} as const;

/**
 * Work style's glyph, picked by its display label: a building, a house, or two
 * arrows for a week split between them. A function returning the icon rather
 * than an icon taking `workStyle`, because <Fact> and the facts tables take an
 * icon component. An unknown or missing label falls back to the building.
 */
export function workStyleIcon(workStyle: string | null) {
  return WORK_STYLE_ICON[workStyle as keyof typeof WORK_STYLE_ICON] ?? OnSiteIcon;
}

export function CalendarIcon({ className }: IconProps) {
  return <Calendar aria-hidden className={className} />;
}

export function MailIcon({ className }: IconProps) {
  return <Mail aria-hidden className={className} />;
}

/* Auth --------------------------------------------------------------------- */

export function LockIcon({ className }: IconProps) {
  return <Lock aria-hidden className={className} />;
}

/* Resume upload ------------------------------------------------------------ */

export function UploadIcon({ className }: IconProps) {
  return <Upload aria-hidden className={className} />;
}

export function TrashIcon({ className }: IconProps) {
  return <Trash2 aria-hidden className={className} />;
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
