/*
 * The Scout page. Every line is a product claim, checked against Scout as
 * built (scout/CLAUDE.md, frontend/docs/screens.md, Experience Bank): Fill
 * With Scout is the one way in today, since Ask Scout is greyed out
 * (ASK_SCOUT_LIVE in components/scout/scout-buttons.tsx), so the page is
 * about filling the bank, and questions about a job posting are only named
 * as not here yet. Identity fields become placeholders on every model call
 * (scout/ identity.py). Bring the job questions back here when the flag
 * turns on.
 */
import { ScoutAnimation } from "../animations";
import type { FeatureContent } from "../types";
import { DraftVisual, PrivacyVisual, WalkVisual } from "../visuals/scout";

const content: FeatureContent = {
  line: "Talk it through. Scout fills your experience bank.",
  meta: {
    title: "Scout",
    description:
      "Scout is WorkIt’s assistant. It asks about your school, jobs and projects and writes each answer up as an entry in your experience bank.",
  },
  hero: {
    title: "Tell Scout what you did. It writes the entries.",
    subtitle:
      "Scout asks about your school, your jobs and your projects, one section at a time, and turns each answer into an entry in your experience bank. You check it and save it.",
  },
  animation: ScoutAnimation,
  sections: [
    {
      eyebrow: "One section at a time",
      title: "It asks the right questions",
      body: "Press Fill With Scout on your Experience Bank. Scout walks your sections in order and asks about each entry. Upload a resume first, and it starts on what the resume left out.",
      visual: WalkVisual,
    },
    {
      eyebrow: "Drafts",
      title: "Every answer becomes an entry",
      body: "As you answer, Scout writes the entry: its title, place, dates and bullets. It tells you what is still missing. Save it, edit it, or skip the section.",
      points: [
        "Type, or speak where your browser supports it",
        "Fill in the card yourself any time",
      ],
      visual: DraftVisual,
    },
    {
      eyebrow: "Privacy",
      title: "Your identity stays out of it",
      body: "WorkIt swaps your name, email, phone number and links for placeholders before anything reaches the model that answers.",
      visual: PrivacyVisual,
    },
  ],
  howItWorks: {
    title: "From a conversation to a full bank",
    steps: [
      { title: "Open your bank", body: "Press Fill With Scout on your Experience Bank." },
      { title: "Answer Scout", body: "Type, or tap the mic." },
      { title: "Save the entry", body: "Check the draft and save it to your bank." },
    ],
  },
  faqs: [
    {
      question: "Is Scout free?",
      answer: "Yes. Every WorkIt account can use Scout, up to a daily limit.",
    },
    {
      question: "What does Scout know about me?",
      answer:
        "Your experience bank and what you tell it. Your name and contact details are swapped for placeholders first.",
    },
    {
      question: "Can I ask Scout about a job posting?",
      answer: "Not yet. Questions about a job posting are coming soon.",
    },
  ],
  cta: {
    title: "Fill your bank with Scout",
    subtitle: "Sign up free and let Scout ask about what you have done.",
  },
};

export default content;
