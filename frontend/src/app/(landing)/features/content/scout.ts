/*
 * STUB COPY. Placeholder text so the Scout page renders; the page's own
 * session replaces every string here, may give the sections their own
 * visuals, and may add an `animation` (until then the stage shows a
 * placeholder panel). The claims are checked against Scout as built
 * (scout/CLAUDE.md), but the wording is not final.
 */
import type { FeatureContent } from "../types";

const content: FeatureContent = {
  line: "Ask about any job posting and how you fit.",
  meta: {
    title: "Scout",
    description:
      "Scout is WorkIt's job search assistant: ask about any job posting, how you fit and what to do next.",
  },
  hero: {
    title: "Scout, your job search assistant",
    subtitle:
      "Ask Scout about any job posting: what the role needs, how you fit, and what to do next. It answers from the posting and your experience bank.",
  },
  sections: [
    {
      eyebrow: "Ask",
      title: "Questions about any job",
      body: "Open Scout beside a job posting and ask what the role involves, which skills it wants, or how your background lines up.",
    },
    {
      eyebrow: "About you",
      title: "Answers about you, not a stranger",
      body: "Scout reads your experience bank, so its answers are about your own skills and experience.",
    },
    {
      eyebrow: "Privacy",
      title: "Your identity stays out of it",
      body: "WorkIt removes your name and contact details from everything before it reaches the model that answers.",
    },
  ],
  howItWorks: {
    title: "From question to next step",
    steps: [
      { title: "Open a job posting", body: "Open Scout beside it with one click." },
      { title: "Ask Scout", body: "Type a question or tap the mic." },
      { title: "Act on it", body: "Tailor, save or apply with what you learned." },
    ],
  },
  faqs: [
    {
      question: "Is Scout free?",
      answer: "Yes. Every WorkIt account can ask Scout a number of questions each day.",
    },
    {
      question: "What does Scout know about me?",
      answer:
        "Your experience bank and the job posting you ask about. Your name and contact details are removed first.",
    },
  ],
  cta: {
    title: "Ask Scout about your next job",
    subtitle: "Sign up free and open Scout beside any job posting.",
  },
};

export default content;
