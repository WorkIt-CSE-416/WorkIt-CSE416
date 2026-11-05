/*
 * The Job Matching page. Every line is a product claim, checked against
 * the app: the score's four parts and its freshness discount
 * (backend/app/services/matching/scoring.py), Best Match as the Jobs
 * page's first sort (frontend/docs/screens.md), the hiring systems the
 * scraper reads (scraper/, data.ts) and the roles it keeps (Intern and New
 * Grad, in every field).
 */
import { MatchingAnimation } from "../animations";
import type { FeatureContent } from "../types";
import { BestMatchVisual, ScoreVisual, SourcesVisual } from "../visuals/matching";

const content: FeatureContent = {
  line: "Every job posting scored on how well you fit.",
  meta: {
    title: "Job Matching",
    description:
      "WorkIt scores internship and new-grad job postings against your experience bank and puts the best fits first.",
  },
  hero: {
    title: "The jobs you fit, first",
    subtitle:
      "WorkIt scores every internship and new-grad job posting against your experience bank, then puts the best fits at the top of your Jobs page.",
  },
  animation: MatchingAnimation,
  sections: [
    {
      eyebrow: "Your score",
      title: "Scored on what you have done",
      body: "Your match score weighs four things from your experience bank: how closely your background reads like the job’s description, your skills, the titles you have held, and the years of experience the posting asks for.",
      points: [
        "A match score on every job posting",
        "Built from your own experience bank",
        "Older postings rank a little lower",
      ],
      visual: ScoreVisual,
    },
    {
      eyebrow: "Best Match",
      title: "The best fits at the top",
      body: "Your Jobs page opens on Best Match, so the postings that fit you most come first, each with its score. Switch to Newest any time.",
      visual: BestMatchVisual,
    },
    {
      eyebrow: "Hiring systems",
      title: "Straight from company job boards",
      body: "WorkIt reads job postings from company job boards on the hiring systems companies use, such as Greenhouse, Lever, Ashby and Workday. Apply Now opens the company’s own application.",
      visual: SourcesVisual,
    },
  ],
  howItWorks: {
    title: "From your experience to your best matches",
    steps: [
      { title: "Fill your bank", body: "Upload a resume or add your experience yourself." },
      { title: "Get scored", body: "WorkIt scores every job posting against your bank." },
      { title: "Start at the top", body: "Open the roles that fit you best first." },
    ],
  },
  faqs: [
    {
      question: "Where do the jobs come from?",
      answer:
        "From company job boards on the hiring systems companies use, such as Greenhouse, Lever, Ashby and Workday.",
    },
    {
      question: "What does the score look at?",
      answer:
        "Your experience bank: how closely it reads like the job’s description, your skills, the titles you have held and the experience the posting asks for.",
    },
    {
      question: "Which roles are listed?",
      answer: "Internships and new-grad roles, in every field, not only tech.",
    },
    {
      question: "Why does a job have no score?",
      answer: "Scores come from your experience bank. Add your experience and every job gets one.",
    },
  ],
  cta: {
    title: "See your best matches",
    subtitle: "Sign up free, upload a resume and WorkIt starts ranking jobs for you.",
  },
};

export default content;
