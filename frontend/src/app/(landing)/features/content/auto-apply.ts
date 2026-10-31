/*
 * STUB COPY. Placeholder text so the Auto Apply page renders; the page's
 * own session replaces every string here and may give the sections their
 * own visuals. Keep every claim true to auto apply as built
 * (auto-apply/architecture.md, autofiller_extension/CLAUDE.md): the
 * extension fills one application at a time and the student clicks Submit
 * on every one. Never say WorkIt submits, sends or applies in parallel.
 */
import AutoApplyVisual from "../../auto-apply-visual";
import type { FeatureContent } from "../types";

const content: FeatureContent = {
  line: "Applications filled in for you. You click Submit.",
  meta: {
    title: "Auto Apply",
    description:
      "WorkIt fills in each application for your best-matched jobs, one at a time. You check every one and click Submit.",
  },
  hero: {
    title: "Applications filled in. You click Submit.",
    subtitle:
      "WorkIt queues your best matches. The Chrome extension fills each application with your details and the right resume, one at a time, and you check every one before you submit it.",
  },
  animation: AutoApplyVisual,
  sections: [
    {
      eyebrow: "Queue",
      title: "Pick the jobs to fill",
      body: "Queue a job from its own Auto Apply button, or add several from your saved jobs. Then pick the ones to fill and press Auto Apply.",
    },
    {
      eyebrow: "Fill",
      title: "Every field, from your profile",
      body: "The WorkIt extension opens each application on the company's own site and fills it from your profile, your experience bank and your saved answers.",
      points: [
        "Contact details, education and work history",
        "Saved answers to the questions forms ask",
        "Drafted answers to written questions, for you to edit",
      ],
    },
    {
      eyebrow: "Resume",
      title: "The right resume attached",
      body: "Each application gets the resume you tailored to that job, or your default resume if you did not tailor one.",
    },
    {
      eyebrow: "Submit",
      title: "You click Submit, every time",
      body: "WorkIt never submits for you. It fills one application at a time; you look it over, fix anything, and click the company's own Submit button.",
    },
  ],
  howItWorks: {
    title: "From your matches to filled applications",
    steps: [
      { title: "Add the extension", body: "Add the WorkIt extension to Chrome." },
      { title: "Queue your jobs", body: "Add jobs to Auto Apply, then pick the ones to fill." },
      { title: "Check each one", body: "The extension fills one application at a time." },
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
      question: "Does it fill many applications at once?",
      answer:
        "No. The extension fills one application at a time, in its own tab, and waits for you.",
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
