/*
 * The Resume Builder page. Every line is a product claim, checked against
 * the app: the bank's sections and upload (frontend/docs/screens.md),
 * Generate Resume in Jake's Resume (the one template), the Download menu
 * (PDF, Word, LaTeX), Tailor (docs/tailor_resume.md: the student picks the
 * missing keywords, one click rewords, each change marked with its Undo),
 * Fit to One Page (docs/cut_to_one_page.md) and sent resumes
 * (docs/sent_resume.md).
 */
import { ResumeAnimation } from "../animations";
import type { FeatureContent } from "../types";
import { BankVisual, BuildVisual, SentResumeVisual, TailorVisual } from "../visuals/resumes";

const content: FeatureContent = {
  line: "One experience bank, a tailored resume for every job.",
  meta: {
    title: "Resume Builder",
    description:
      "Build a resume from your experience bank, tailor it to each job posting, and download it as a PDF, Word or LaTeX file.",
  },
  hero: {
    title: "A tailored resume for every job",
    subtitle:
      "Put everything you have done in one experience bank, or upload the resume you have. WorkIt builds your resume from it and tailors a copy to each job posting you pick.",
  },
  animation: ResumeAnimation,
  sections: [
    {
      eyebrow: "Experience bank",
      title: "Everything you have done, in one place",
      body: "Upload your resume and WorkIt reads it into your bank: education, experience, projects, leadership, awards, certifications and skills. Or add each entry yourself.",
      points: [
        "Start from the resume you already have",
        "Edit every entry in one place",
        "Your skills feed your match scores too",
      ],
      visual: BankVisual,
    },
    {
      eyebrow: "Build",
      title: "A clean resume in one click",
      body: "Press Generate Resume and WorkIt lays out your bank in the Jake’s Resume template. Edit any line, then download it.",
      points: ["Fit to One Page trims it until it fits", "Download as PDF, Word or LaTeX"],
      visual: BuildVisual,
    },
    {
      eyebrow: "Tailor",
      title: "Tailored to each job posting",
      body: "Open a job posting and press Tailor My Resume. WorkIt shows which of the posting’s keywords your resume already has. Pick the missing ones you have really used, and one click rewords your bullets for the job.",
      points: [
        "A keyword you do not pick is never added",
        "Every change is marked on the resume",
        "Undo one change, or all of them",
      ],
      visual: TailorVisual,
    },
    {
      eyebrow: "Sent resumes",
      title: "Know which resume went where",
      body: "When you mark a job applied, WorkIt keeps the resume you sent with the application. Open it from your tracker before the interview.",
      visual: SentResumeVisual,
    },
  ],
  howItWorks: {
    title: "From your experience to a tailored resume",
    steps: [
      { title: "Fill your bank", body: "Upload a resume or add your experience yourself." },
      { title: "Generate a resume", body: "WorkIt lays it out from your bank." },
      { title: "Tailor it", body: "Pick the keywords you have used for a job posting." },
      { title: "Apply with it", body: "WorkIt keeps the resume you sent." },
    ],
  },
  faqs: [
    {
      question: "Do I need a resume to start?",
      answer:
        "No. Add your entries yourself, or let Scout ask you about them. If you upload a resume, WorkIt reads it into your bank.",
    },
    {
      question: "Does tailoring make things up?",
      answer:
        "Tailor rewords what is in your bank. It adds a keyword only when you pick it, so pick only skills you have used: an interviewer can ask about each one.",
    },
    {
      question: "Which files can I download?",
      answer: "PDF, Word and LaTeX.",
    },
    {
      question: "Which templates are there?",
      answer: "One for now: Jake’s Resume, a plain one-column layout.",
    },
  ],
  cta: {
    title: "Build your first resume",
    subtitle: "Sign up free and start from the resume you already have.",
  },
};

export default content;
