import type { Metadata } from "next";

import { LegalPage, TeamToDecide } from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What WorkIt collects, why, who it shares it with, and the choices you have.",
};

/**
 * The public Privacy Policy, a draft for the team to review. Every statement
 * describes what the code does today; a business decision the code cannot
 * answer is a TeamToDecide placeholder, never a guess. Change this page
 * together with the behaviour it describes.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        WorkIt (<a href="https://workitjobs.ai">workitjobs.ai</a>) helps students find job postings,
        build and tailor resumes, fill job applications and track them. This policy says what
        information WorkIt collects, why, who it shares it with, and the choices you have. WorkIt is
        operated by <TeamToDecide>legal name of the operator</TeamToDecide>.
      </p>

      <h2>Information You Give Us</h2>
      <ul>
        <li>
          <strong>Your account.</strong> Your name, email address and password. Supabase Auth, our
          sign-in provider, stores your password. WorkIt&apos;s own database does not.
        </li>
        <li>
          <strong>Google or LinkedIn sign-in.</strong> If you sign in with Google or LinkedIn, the
          provider shares your name, email address and basic profile details with our sign-in
          provider. We use them only to create your account and sign you in. We do not ask for
          access to your email, contacts, files or calendar.
        </li>
        <li>
          <strong>Your profile.</strong> Your phone number, headline, contact email, links
          (LinkedIn, portfolio, GitHub and one other) and an optional profile photo.
        </li>
        <li>
          <strong>Your resumes.</strong> Resume files you upload, the text we read from them, and
          resumes you build in WorkIt. We keep a copy of each resume you send with an application,
          so you can see what an employer received.
        </li>
        <li>
          <strong>Your experiences.</strong> The education, work, projects, bullets and skills you
          add to your experience bank.
        </li>
        <li>
          <strong>Your job preferences.</strong> The work styles, experience levels, job types,
          start dates, pay range, roles and locations you want, and whether you need visa
          sponsorship.
        </li>
        <li>
          <strong>Your application answers.</strong> Answers to questions that hiring systems ask on
          most applications: work authorization, sponsorship, citizenship and visa status, and
          security clearance. You can also give voluntary self-identification answers (gender,
          Hispanic or Latino, race, veteran status and disability). These are optional, and you can
          choose not to answer.
        </li>
        <li>
          <strong>Your applications.</strong> The job postings you save or apply to, each
          application&apos;s stage and dates, and the resume you sent with it.
        </li>
      </ul>

      <h2>Information We Collect Automatically</h2>
      <ul>
        <li>
          <strong>Session cookies.</strong> WorkIt sets cookies that keep you signed in. WorkIt does
          not use advertising or analytics cookies.
        </li>
        <li>
          <strong>AI feature use.</strong> We count how many times you use each AI feature each day,
          to apply daily limits.
        </li>
        <li>
          <strong>Server logs.</strong> Our hosting providers keep standard request logs.{" "}
          <TeamToDecide>what these logs hold and how long they are kept</TeamToDecide>
        </li>
      </ul>

      <h2>Job Postings</h2>
      <p>
        The Jobs page shows job postings that we read from public company job boards on hiring
        systems such as Greenhouse. These postings describe jobs, not you.
      </p>

      <h2>How We Use Your Information</h2>
      <ul>
        <li>To create your account and sign you in.</li>
        <li>To match you with job postings and show how well each one fits.</li>
        <li>To build, tailor and download your resumes.</li>
        <li>To fill job applications when you ask, and to track your applications.</li>
        <li>To run Scout, the job assistant, and the other AI features you use.</li>
        <li>To keep WorkIt working, secure and within its daily limits.</li>
      </ul>
      <p>We do not sell your information. We do not use it for advertising.</p>

      <h2>AI Features</h2>
      <p>
        Scout, resume tailoring, resume import, written answers to application questions and job
        matching send text to AI model providers. This text comes from your experiences, resumes and
        the job postings you look at. Before any text leaves WorkIt, we remove your name, email
        address, phone number and links, and any other email address, web address or phone number in
        it. Your application answers, including self-identification answers, are not sent to AI
        model providers.
      </p>
      <p>
        The providers WorkIt is set up to use include Google (Gemini) and Groq. Job matching sends
        text to Google (Gemini) only when that is turned on.{" "}
        <TeamToDecide>the final list of AI model providers</TeamToDecide> Some of these
        providers&apos; free plans let them use the text they receive to improve their services.
        Because we remove your identity details first, that text does not include your name or
        contact details.
      </p>
      <p>
        AI output can be wrong. WorkIt checks that tailored resume text and written answers do not
        add facts you did not give, but you should still review what the AI wrote.
      </p>

      <h2>The WorkIt Chrome Extension</h2>
      <p>
        The WorkIt Chrome extension fills job applications on hiring systems with your WorkIt
        information. It reads WorkIt&apos;s sign-in cookie so that it can get your information from
        WorkIt as you. It fills an application only when you click to start it, either in the
        extension or with Auto Apply. It never submits an application. You review what it filled and
        click Submit yourself.
      </p>

      <h2>Who We Share Information With</h2>
      <ul>
        <li>
          <strong>Service providers that run WorkIt:</strong> Supabase (sign-in, database and file
          storage), Cloudflare and Vercel (hosting), and the AI model providers above.
        </li>
        <li>
          <strong>Employers, only when you apply.</strong> When you fill an application on a hiring
          system and submit it, the employer and its hiring system get what you submit. WorkIt does
          not send it for you.
        </li>
        <li>
          <strong>When the law requires it.</strong>{" "}
          <TeamToDecide>how WorkIt answers legal requests</TeamToDecide>
        </li>
      </ul>

      <h2>How Long We Keep Information</h2>
      <p>
        We keep your information while your account exists.{" "}
        <TeamToDecide>
          retention period after an account closes, and for backups and logs
        </TeamToDecide>
      </p>

      <h2>Your Choices</h2>
      <ul>
        <li>
          You can change or delete your profile, profile photo, resumes, experiences, preferences,
          application answers and tracked applications in WorkIt at any time.
        </li>
        <li>
          WorkIt has no button to delete your account yet. Deleting an account deletes its profile
          and everything linked to it. To ask us to delete your account, contact{" "}
          <TeamToDecide>contact email for privacy requests</TeamToDecide>.
        </li>
        <li>
          <TeamToDecide>
            privacy rights by region (for example GDPR or CCPA) and how to use them
          </TeamToDecide>
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Every request for your information goes through WorkIt&apos;s server, which checks that you
        are signed in and that the information is yours. No system is perfectly secure, and we
        cannot promise that your information will never be accessed without permission.
      </p>

      <h2>Children</h2>
      <p>
        WorkIt is for students looking for jobs and internships. You must be at least{" "}
        <TeamToDecide>minimum age</TeamToDecide> to use it.
      </p>

      <h2>Where Your Information Is Stored</h2>
      <p>
        <TeamToDecide>the country or region where data is stored and processed</TeamToDecide>
      </p>

      <h2>Changes to This Policy</h2>
      <p>
        When we change this policy, we update the date at the top of this page.{" "}
        <TeamToDecide>how users are told about important changes</TeamToDecide>
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy: <TeamToDecide>contact email</TeamToDecide>
      </p>
    </LegalPage>
  );
}
