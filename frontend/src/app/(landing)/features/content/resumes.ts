/*
 * STUB COPY. Placeholder text so the Resume Builder page renders; the page's
 * own session replaces every string here and may give the sections their
 * own visuals. The claims are checked against the app (the experience
 * bank, Tailor, sent resumes), but the wording is not final.
 */
import ResumeVisual from "../../resume-visual";
import type { FeatureContent } from "../types";

const content: FeatureContent = {
  line: "One experience bank, a tailored resume for every job.",
  meta: {
    title: "Resume Builder",
    description:
      "Build a resume from your experience bank and tailor it to every job posting with WorkIt.",
  },
  hero: {
    title: "A tailored resume for every job",
    subtitle:
      "Put everything you have done in one experience bank, or upload the resume you have. WorkIt builds your resume from it and tailors a copy to each job posting.",
  },
  animation: ResumeVisual,
  sections: [
    {
      eyebrow: "Experience bank",
      title: "Everything you have done, in one place",
      body: "Add your education, jobs, projects and skills once. Upload a resume and WorkIt reads it into your bank for you to check.",
      points: [
        "Start from the resume you already have",
        "Edit every fact in one place",
        "Your skills feed your match scores too",
      ],
    },
    {
      eyebrow: "Build",
      title: "A clean resume in one click",
      body: "WorkIt builds a clean resume from your bank. Download it as a PDF or a Word file.",
    },
    {
      eyebrow: "Tailor",
      title: "Tailored to each job posting",
      body: "Tailor compares your resume with the job posting and suggests changes: a bullet to rewrite, one to cut, a skill to add. Every change is marked on the resume, and you can undo it.",
      points: [
        "See the keyword match before and after",
        "Undo any change with one click",
        "A missing skill is added only when you say you have it",
      ],
    },
    {
      eyebrow: "Sent resumes",
      title: "Know which resume went where",
      body: "When you apply, WorkIt keeps the resume you sent with the application, so you can read it again before the interview.",
    },
  ],
  howItWorks: {
    title: "From your experience to a tailored resume",
    steps: [
      { title: "Fill your bank", body: "Upload a resume or add your experience by hand." },
      { title: "Build a resume", body: "WorkIt lays out a resume from your bank." },
      { title: "Tailor it", body: "Open a job posting and keep the changes that fit." },
      { title: "Apply with it", body: "WorkIt keeps a copy of the resume you sent." },
    ],
  },
  faqs: [
    {
      question: "Do I need a resume to start?",
      answer:
        "No. Fill your experience bank from scratch, or upload a resume and WorkIt reads it in for you.",
    },
    {
      question: "Does tailoring make things up?",
      answer:
        "No. Tailor works from your experience bank, and it adds a missing skill only when you confirm you have used it.",
    },
    {
      question: "Which file types can I download?",
      answer: "PDF and Word.",
    },
  ],
  cta: {
    title: "Build your first resume",
    subtitle: "Sign up free and start from the resume you already have.",
  },
};

export default content;
