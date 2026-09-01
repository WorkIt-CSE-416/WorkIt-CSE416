/**
 * The fixtures the KAN-43 profile mockup renders against. Nothing reads or
 * writes them yet — they exist so the screen has something to show.
 */

export const PROFILE = {
  name: "Alex Chen",
  title: "Senior Full Stack Developer",
  email: "alex.chen@example.com",
  phone: "+1 (555) 123-4567",
  location: "San Francisco, CA",
};

export const RESUME = {
  fileName: "Alex_Chen_Resume_2024.pdf",
  meta: "Uploaded 2 days ago • 1.2 MB",
};

export const ROLES = [
  {
    title: "Senior Full Stack Developer",
    company: "TechFlow Solutions",
    period: "Jan 2021 - Present",
    location: "San Francisco, CA",
    current: true,
    summary:
      "Led development of core SaaS platform features, improving application performance by 40%. Mentored junior developers and instituted new CI/CD pipelines.",
  },
  {
    title: "Software Engineer",
    company: "InnovaSystems",
    period: "Jun 2018 - Dec 2020",
    location: "Austin, TX",
    current: false,
    summary:
      "Developed robust API endpoints and responsive front-end interfaces using React and Node.js. Reduced technical debt by migrating legacy codebase to modern standards.",
  },
];

export const SKILLS = [
  "JavaScript",
  "React",
  "Node.js",
  "TypeScript",
  "GraphQL",
  "AWS",
  "Docker",
  "Tailwind CSS",
];
