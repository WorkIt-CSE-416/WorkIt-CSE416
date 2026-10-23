import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage, TeamToDecide } from "../legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The rules for using WorkIt.",
};

/**
 * The public Terms of Service, a draft for the team to review. Like
 * /privacy, it describes only what WorkIt does today, and leaves each
 * business or legal decision as a TeamToDecide placeholder.
 */
export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms are the rules for using WorkIt (
        <a href="https://workitjobs.ai">workitjobs.ai</a>) and the WorkIt Chrome extension. WorkIt
        is operated by <TeamToDecide>legal name of the operator</TeamToDecide>. By creating an
        account or using WorkIt, you agree to these terms and to our{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>Who Can Use WorkIt</h2>
      <p>
        WorkIt is for students and recent graduates looking for jobs and internships. You must be at
        least <TeamToDecide>minimum age</TeamToDecide> to use it. Business accounts are not
        available yet.
      </p>

      <h2>Your Account</h2>
      <ul>
        <li>Give accurate information when you sign up, and keep it up to date.</li>
        <li>Keep your password safe. You are responsible for what happens in your account.</li>
        <li>One email address has one WorkIt account.</li>
      </ul>

      <h2>Your Content</h2>
      <p>
        Your profile, resumes, experiences and answers stay yours. You let WorkIt store and process
        them only to run WorkIt for you: for example, to match you with job postings, build and
        tailor resumes, fill applications and run the AI features you use. Do not add content that
        you do not have the right to use.
      </p>

      <h2>AI Features</h2>
      <p>
        Scout and WorkIt&apos;s other AI features can make mistakes. Review every resume, answer and
        suggestion before you send it to an employer. You are responsible for what you submit. AI
        features have daily limits, and we can change them.
      </p>

      <h2>Filling Applications</h2>
      <p>
        The WorkIt Chrome extension and Auto Apply fill applications on hiring systems with your
        WorkIt information. They start only when you click, and they never submit an application.
        You review each application and click Submit yourself. You are responsible for following the
        rules of each hiring system and employer.
      </p>

      <h2>Job Postings</h2>
      <p>
        The Jobs page shows job postings from public company job boards. We do not write these
        postings, and we cannot promise that they are accurate, current or still open. WorkIt is not
        the employer, and it cannot promise that you will get an interview or a job.
      </p>

      <h2>Acceptable Use</h2>
      <ul>
        <li>Do not use WorkIt to break the law or to harm other people.</li>
        <li>Do not give false information to employers through WorkIt.</li>
        <li>Do not try to get into other people&apos;s accounts or data.</li>
        <li>
          Do not overload, scrape or attack WorkIt, or try to get around its limits or security.
        </li>
      </ul>

      <h2>Ending Your Use</h2>
      <p>
        You can stop using WorkIt at any time. To delete your account, see the Privacy Policy. We
        can suspend or close an account that breaks these terms.{" "}
        <TeamToDecide>notice given before an account is closed</TeamToDecide>
      </p>

      <h2>Changes to WorkIt and These Terms</h2>
      <p>
        WorkIt is still being built, and features can change or stop. When we change these terms, we
        update the date at the top of this page.{" "}
        <TeamToDecide>how users are told about important changes</TeamToDecide>
      </p>

      <h2>Disclaimers and Limits of Liability</h2>
      <p>
        <TeamToDecide>
          warranty disclaimer and limitation of liability, after legal review
        </TeamToDecide>
      </p>

      <h2>Governing Law</h2>
      <p>
        <TeamToDecide>governing law and where disputes are decided</TeamToDecide>
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <TeamToDecide>contact email</TeamToDecide>
      </p>
    </LegalPage>
  );
}
