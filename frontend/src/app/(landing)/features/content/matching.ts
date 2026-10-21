/*
 * STUB COPY. Placeholder text so the Job Matching page renders; the page's
 * own session replaces every string here and may give the sections their
 * own visuals. The claims are checked against the app (the score in
 * backend/app/services/matching/scoring.py, the hiring systems in data.ts),
 * but the wording is not final.
 */
import MatchingVisual from "../../matching-visual";
import type { FeatureContent } from "../types";

const content: FeatureContent = {
  line: "Every job posting scored on how well you fit.",
  meta: {
    title: "Job Matching",
    description:
      "WorkIt scores internships and new-grad job postings against your experience and puts the best fits first.",
  },
  hero: {
    title: "The jobs you fit, first",
    subtitle:
      "WorkIt scores every internship and new-grad job posting against your experience bank, then puts the best fits at the top.",
  },
  animation: MatchingVisual,
  sections: [
    {
      eyebrow: "Your score",
      title: "Scored on what you have done",
      body: "The score reads your experience bank: how closely your background matches the job's description, your skills, the titles you have held and your experience.",
      points: ["A match score on every job posting", "Built from your own experience bank"],
    },
    {
      eyebrow: "Best Match",
      title: "The best fits at the top",
      body: "Sort the Jobs page by Best Match and the postings that fit you most come first, each with its score on the card.",
    },
    {
      eyebrow: "Hiring systems",
      title: "Straight from company job boards",
      body: "WorkIt reads job postings from company job boards on hiring systems such as Greenhouse, Lever, Ashby and Workday, so every role links to the company's own application.",
    },
  ],
  howItWorks: {
    title: "From your experience to your best matches",
    steps: [
      { title: "Fill your bank", body: "Upload a resume or add your experience by hand." },
      { title: "Get scored", body: "WorkIt scores every job posting against your bank." },
      { title: "Start at the top", body: "Sort by Best Match and open the roles that fit." },
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
        "Your experience bank: how closely it matches the job's description, your skills, the titles you have held and your experience.",
    },
    {
      question: "Which roles are listed?",
      answer: "Internships and new-grad roles.",
    },
  ],
  cta: {
    title: "See your best matches",
    subtitle: "Sign up free, upload a resume and WorkIt starts ranking jobs for you.",
  },
};

export default content;
