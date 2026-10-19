/**
 * Sample jobs for the homepage application-board showcase
 * (src/components/react/ApplicationBoard.tsx). Companies are fictional; each
 * stage becomes one scrolling column. Card layout mirrors the WorkIt product.
 */
import {
  Bookmark,
  Building,
  Calendar,
  CalendarCheck,
  CircleDollarSign,
  Clock,
  Cloud,
  Database,
  Gamepad2,
  GraduationCap,
  Handshake,
  HeartPulse,
  Leaf,
  MessagesSquare,
  Music,
  Newspaper,
  Palette,
  Plane,
  Rocket,
  Send,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface TrackedJob {
  title: string;
  note: string;
  company: string;
  logo: LucideIcon;
  /** Tailwind classes for the company logo tile. */
  logoTone: string;
  /** Percentage shown in the ring badge. */
  score: number;
  next: { label: string; when: string };
  footer: string;
}

export interface Stage {
  id: "saved" | "applied" | "interview" | "offer";
  /** Column name, as used in the product. */
  label: string;
  /** One line under the stage in the homepage section's stage list. */
  description: string;
  /** Label for a single card in this stage. */
  cardLabel: string;
  chipClass: string;
  /** Status icon shown in the stage chips (legend and cards). */
  icon: LucideIcon;
  iconClass: string;
  footerIcon: LucideIcon;
  jobs: TrackedJob[];
}

export const stages: Stage[] = [
  {
    id: "saved",
    label: "Saved",
    description: "Bookmark roles worth a closer look.",
    cardLabel: "Saved",
    chipClass: "bg-slate-100 text-slate-700",
    icon: Bookmark,
    iconClass: "text-slate-600",
    footerIcon: Clock,
    jobs: [
      {
        title: "Product Designer",
        note: "Loved their design system talk. Portfolio review comes first.",
        company: "Pixel & Co",
        logo: Palette,
        logoTone: "bg-pink-50 text-pink-600",
        score: 88,
        next: { label: "Tailor portfolio", when: "Due Sep 24" },
        footer: "Posting closes: Oct 3",
      },
      {
        title: "Data Analyst",
        note: "Hybrid role with a strong SQL focus. Ask a former teammate for a referral.",
        company: "Orbit Analytics",
        logo: Rocket,
        logoTone: "bg-violet-50 text-violet-600",
        score: 81,
        next: { label: "Request referral", when: "Sep 26" },
        footer: "Posting closes: Oct 10",
      },
      {
        title: "iOS Engineer",
        note: "SwiftUI-heavy team, remote-friendly across time zones.",
        company: "Skyway Travel",
        logo: Plane,
        logoTone: "bg-sky-50 text-sky-600",
        score: 76,
        next: { label: "Update resume", when: "Sep 27" },
        footer: "Posting closes: Oct 14",
      },
      {
        title: "Content Strategist",
        note: "Owns the help center and in-app copy. Great fit for my background.",
        company: "Learnly",
        logo: GraduationCap,
        logoTone: "bg-amber-50 text-amber-600",
        score: 84,
        next: { label: "Draft cover letter", when: "Sep 29" },
        footer: "Posting closes: Oct 18",
      },
    ],
  },
  {
    id: "applied",
    label: "Applied",
    description: "Know when you applied and when to follow up.",
    cardLabel: "Applied",
    chipClass: "bg-landing-brand-100 text-landing-brand-800",
    icon: Send,
    iconClass: "text-landing-brand-600",
    footerIcon: CalendarCheck,
    jobs: [
      {
        title: "Frontend Engineer",
        note: "Applied through the careers page with a referral from the design lead.",
        company: "Nimbus Cloud",
        logo: Cloud,
        logoTone: "bg-sky-50 text-sky-600",
        score: 92,
        next: { label: "Follow up with recruiter", when: "Oct 1, 10:00 AM EST" },
        footer: "Applied: Sep 22",
      },
      {
        title: "UX Researcher",
        note: "A take-home study may follow if the first screen goes well.",
        company: "Acme Health",
        logo: HeartPulse,
        logoTone: "bg-rose-50 text-rose-600",
        score: 79,
        next: { label: "Recruiter Screen", when: "Oct 3, 2:30 PM EST" },
        footer: "Applied: Sep 19",
      },
      {
        title: "Marketing Manager",
        note: "Leads lifecycle email. Salary range is listed on the posting.",
        company: "Cartly",
        logo: ShoppingBag,
        logoTone: "bg-orange-50 text-orange-600",
        score: 74,
        next: { label: "Check application status", when: "Oct 6" },
        footer: "Applied: Sep 15",
      },
      {
        title: "QA Engineer",
        note: "Automation-first team. They asked for test plan samples.",
        company: "SecureStack",
        logo: ShieldCheck,
        logoTone: "bg-indigo-50 text-indigo-600",
        score: 86,
        next: { label: "Send work samples", when: "Oct 2" },
        footer: "Applied: Sep 24",
      },
    ],
  },
  {
    id: "interview",
    label: "Interview",
    description: "See every round and prep for the next one.",
    cardLabel: "Interview",
    chipClass: "bg-amber-100 text-amber-800",
    icon: MessagesSquare,
    iconClass: "text-amber-700",
    footerIcon: Users,
    jobs: [
      {
        title: "Full-Stack Engineer",
        note: "Panel went well. The system design round is next.",
        company: "DataForge",
        logo: Database,
        logoTone: "bg-cyan-50 text-cyan-600",
        score: 89,
        next: { label: "System Design Interview", when: "Oct 8, 1:00 PM EST" },
        footer: "Interview round 3 of 4",
      },
      {
        title: "Product Manager",
        note: "Hiring manager wants a walkthrough of the roadmap exercise.",
        company: "Greenfield Energy",
        logo: Leaf,
        logoTone: "bg-green-50 text-green-600",
        score: 83,
        next: { label: "Case Study Presentation", when: "Oct 9, 11:00 AM EST" },
        footer: "Interview round 2 of 3",
      },
      {
        title: "Backend Engineer",
        note: "Pairing session on their payments API with two engineers.",
        company: "Tempo",
        logo: Music,
        logoTone: "bg-violet-50 text-violet-600",
        score: 91,
        next: { label: "Pair Programming", when: "Oct 7, 3:30 PM EST" },
        footer: "Interview round 2 of 4",
      },
      {
        title: "Design Systems Lead",
        note: "Met the team on-site. Final round is with the VP of Design.",
        company: "Playfield Games",
        logo: Gamepad2,
        logoTone: "bg-purple-50 text-purple-600",
        score: 87,
        next: { label: "Final Interview", when: "Oct 10, 9:00 AM EST" },
        footer: "Interview round 4 of 4",
      },
    ],
  },
  {
    id: "offer",
    label: "Job Offers",
    description: "Compare offers before the deadline to accept.",
    cardLabel: "Job Offer",
    chipClass: "bg-emerald-100 text-emerald-800",
    icon: Handshake,
    iconClass: "text-emerald-700",
    footerIcon: Calendar,
    jobs: [
      {
        title: "UI Developer",
        note: "Offer in hand for their payments dashboard team. Needs an answer by the 20th.",
        company: "FinTech Corp",
        logo: CircleDollarSign,
        logoTone: "bg-emerald-50 text-emerald-700",
        score: 90,
        next: { label: "Negotiation Call", when: "Oct 17, 4:00 PM EST" },
        footer: "Deadline to accept: Oct 20",
      },
      {
        title: "DevOps Engineer",
        note: "Remote offer with a signing bonus. Comparing benefits packages.",
        company: "Northwind Logistics",
        logo: Truck,
        logoTone: "bg-amber-50 text-amber-700",
        score: 85,
        next: { label: "Benefits Review", when: "Oct 15, 12:00 PM EST" },
        footer: "Deadline to accept: Oct 22",
      },
      {
        title: "Growth Marketer",
        note: "Verbal offer received. The written offer is on the way.",
        company: "Brightline Media",
        logo: Newspaper,
        logoTone: "bg-rose-50 text-rose-600",
        score: 78,
        next: { label: "Review Written Offer", when: "Oct 14" },
        footer: "Deadline to accept: Oct 24",
      },
      {
        title: "Customer Success Manager",
        note: "Offer includes a relocation package. Talking it over this week.",
        company: "Summit Realty",
        logo: Building,
        logoTone: "bg-slate-100 text-slate-700",
        score: 82,
        next: { label: "Call Hiring Manager", when: "Oct 16, 10:00 AM EST" },
        footer: "Deadline to accept: Oct 27",
      },
    ],
  },
];
