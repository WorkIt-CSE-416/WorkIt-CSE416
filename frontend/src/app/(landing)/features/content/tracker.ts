/*
 * STUB COPY. Placeholder text so the Application Tracker page renders; the
 * page's own session replaces every string here and may give the sections
 * their own visuals. The claims are checked against the Applications page
 * as built (frontend/docs/screens.md, Applications): saved and applied
 * jobs only for now, since Interviewing and Offer stay empty until the API
 * stores them. The wording is not final.
 */
import UpdatesVisual from "../../updates-visual";
import type { FeatureContent } from "../types";

const content: FeatureContent = {
  line: "Every job you save or apply to, in one list.",
  meta: {
    title: "Application Tracker",
    description:
      "Keep every job you save or apply to in one list, with its match score and the resume you sent.",
  },
  hero: {
    title: "Every application, in one place",
    subtitle:
      "Save a job or apply to it and it lands on your tracker, with its status, its match score and the resume you sent.",
  },
  // The home tour's Updates stop.
  animation: UpdatesVisual,
  sections: [
    {
      eyebrow: "One list",
      title: "Saved and applied, side by side",
      body: "Every job you save or apply to sits in one list you can sort and filter, with the role, the company, the date and your match score.",
    },
    {
      eyebrow: "Did you apply?",
      title: "It asks when you come back",
      body: "Open a company's application from WorkIt and, when you come back, WorkIt asks if you applied. Say yes and the job moves to Applied.",
    },
    {
      eyebrow: "Sent resume",
      title: "The resume you sent, one click away",
      body: "Each application keeps the resume it went out with, so you can read exactly what the recruiter saw before your interview.",
    },
  ],
  howItWorks: {
    title: "From saved to applied",
    steps: [
      { title: "Save jobs you like", body: "One click on any job posting." },
      { title: "Apply", body: "Apply on the company's site, then tell WorkIt you did." },
      { title: "Keep track", body: "Every application waits in one list." },
    ],
  },
  faqs: [
    {
      question: "How do jobs get on my tracker?",
      answer: "Save a job, or tell WorkIt you applied to it.",
    },
    {
      question: "Can I see which resume I sent?",
      answer: "Yes. Each application keeps the resume it went out with.",
    },
  ],
  cta: {
    title: "Stop tracking applications in a spreadsheet",
    subtitle: "Sign up free and every job you save or apply to lands in one list.",
  },
};

export default content;
