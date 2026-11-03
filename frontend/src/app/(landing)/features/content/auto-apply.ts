/*
 * The Auto Apply page. Every line is a product claim, checked against auto
 * apply as built (auto-apply/architecture.md, autofiller_extension/CLAUDE.md):
 * the student queues jobs; the extension fills up to five applications at
 * once, each in its own tab, from the profile, the bank and the saved
 * answers; it attaches the default resume, which the student can change in
 * its panel; WorkIt writes no answer to a new written question; and it never
 * submits. Never say WorkIt submits, sends or applies.
 */
import { AutoApplyAnimation } from "../animations";
import type { FeatureContent } from "../types";
import { AttachVisual, FillVisual, QueueVisual, SubmitVisual } from "../visuals/auto-apply";

const content: FeatureContent = {
  line: "Applications filled in for you. You click Submit.",
  meta: {
    title: "Auto Apply",
    description:
      "Queue the jobs you want and the WorkIt Chrome extension fills in each application. You check every one and click Submit.",
  },
  hero: {
    title: "Applications filled in. You click Submit.",
    subtitle:
      "Queue the jobs you want. The WorkIt Chrome extension opens each application on the company’s site and fills it in from your profile, and you check every one before you submit it.",
  },
  animation: AutoApplyAnimation,
  sections: [
    {
      eyebrow: "Queue",
      title: "Pick the jobs to fill",
      body: "Press Auto Apply on a job, or add your saved jobs from the Auto Apply page. Up Next lists them all: pick the ones to fill and press Auto Apply.",
      visual: QueueVisual,
    },
    {
      eyebrow: "Fill",
      title: "Every field, from your profile",
      body: "The extension fills each form from your profile, your experience bank and the answers you saved in Application Info, on hiring systems such as Greenhouse, Lever, Ashby and Workday.",
      points: [
        "Contact details, education and work history",
        "Your saved answers to the questions forms ask",
        "A new written question waits for your answer",
      ],
      visual: FillVisual,
    },
    {
      eyebrow: "Resume",
      title: "Your resume, attached",
      body: "Each form gets your default resume. To send the one you tailored for the job, press Change in the WorkIt panel before you submit.",
      visual: AttachVisual,
    },
    {
      eyebrow: "Submit",
      title: "You click Submit, every time",
      body: "WorkIt never submits for you. It fills up to five applications at a time, each in its own tab. Look each one over, fix anything, and click the company’s own Submit button.",
      visual: SubmitVisual,
    },
  ],
  howItWorks: {
    title: "From your matches to filled applications",
    steps: [
      { title: "Add the extension", body: "Add WorkIt to Chrome from the Chrome Web Store." },
      { title: "Queue your jobs", body: "Add jobs to Up Next, then pick the ones to fill." },
      { title: "Check each one", body: "The extension fills each application in its own tab." },
      { title: "Click Submit", body: "You send every application yourself." },
    ],
  },
  faqs: [
    {
      question: "Does WorkIt submit applications for me?",
      answer:
        "No. WorkIt fills in each application, and you check it and click Submit yourself, every time.",
    },
    {
      question: "How many applications does it fill at once?",
      answer: "Up to five, each in its own tab. The rest wait in Up Next.",
    },
    {
      question: "What about written questions?",
      answer:
        "A question you answered before fills from your saved answers. A new one is yours to write: the form waits for you.",
    },
    {
      question: "Do I need the Chrome extension?",
      answer:
        "Yes. Auto Apply fills applications in your own Chrome, through the WorkIt extension.",
    },
  ],
  cta: {
    title: "Let WorkIt do the typing",
    subtitle: "Sign up free and queue your first best matches.",
  },
};

export default content;
