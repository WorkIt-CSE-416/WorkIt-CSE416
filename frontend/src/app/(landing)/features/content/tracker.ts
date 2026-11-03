/*
 * The Application Tracker page. Every line is a product claim, checked
 * against the Applications page as built (frontend/docs/screens.md,
 * Applications): the five stages, set by hand from an application's stage
 * menu; "Did You Apply?" after Apply Now; Interviews & Dates on an
 * application's page; the sent resume (docs/sent_resume.md). WorkIt reads
 * no email (the Inbox is archived, docs/email_tracker.md), so no line says
 * an employer's reply moves an application.
 */
import { UpdatesAnimation } from "../animations";
import type { FeatureContent } from "../types";
import { SentResumeVisual } from "../visuals/resumes";
import { AskedVisual, ListVisual, StageVisual } from "../visuals/tracker";

const content: FeatureContent = {
  line: "Every job you save or apply to, in one list.",
  meta: {
    title: "Application Tracker",
    description:
      "Keep every job you save or apply to in one list, with its stage, its match score and the resume you sent.",
  },
  hero: {
    title: "Every application, in one place",
    subtitle:
      "Save a job or apply to it and it lands on your tracker. Move it to Interviewing or Offer as you hear back, with the resume you sent one click away.",
  },
  // The home tour's Updates stop.
  animation: UpdatesAnimation,
  sections: [
    {
      eyebrow: "One list",
      title: "Saved and applied, side by side",
      body: "Every job you save or apply to sits in one list, with its stage and your match score. Search it, filter it by status, and sort it by date, match or pay.",
      visual: ListVisual,
    },
    {
      eyebrow: "Did you apply?",
      title: "It asks when you come back",
      body: "Press Apply Now and the company’s application opens in a new tab. When you come back, WorkIt asks if you applied and which resume you sent. Say yes and the job moves to Applied.",
      visual: AskedVisual,
    },
    {
      eyebrow: "Stages",
      title: "Move it along as you hear back",
      body: "Set each application’s stage yourself: Applied, Interviewing, Offer or Rejected. Add an interview or an assessment to its page, so the date stays with the job.",
      visual: StageVisual,
    },
    {
      eyebrow: "Sent resume",
      title: "The resume you sent, one click away",
      body: "Each application keeps the resume it went out with, so you can read what the recruiter saw before your interview.",
      visual: SentResumeVisual,
    },
  ],
  howItWorks: {
    title: "From saved to offer",
    steps: [
      { title: "Save jobs you like", body: "One click on any job posting." },
      { title: "Apply", body: "Apply on the company’s site, then tell WorkIt you did." },
      { title: "Keep track", body: "Move each application along as you hear back." },
    ],
  },
  faqs: [
    {
      question: "How do jobs get on my tracker?",
      answer: "Save a job, tell WorkIt you applied to it, or submit it through Auto Apply.",
    },
    {
      question: "Can I see which resume I sent?",
      answer: "Yes. Each application keeps the resume it went out with.",
    },
    {
      question: "Does WorkIt read my email for replies?",
      answer: "Not yet. For now, you set each application’s stage yourself.",
    },
  ],
  cta: {
    title: "Stop tracking applications in a spreadsheet",
    subtitle: "Sign up free and every job you save or apply to lands in one list.",
  },
};

export default content;
