import type { Metadata } from "next";
import Link from "next/link";

import { claudeConnectorLink } from "@/lib/claude-connector";

export const metadata: Metadata = {
  title: "WorkIt Connector for Claude",
  description:
    "Add WorkIt to your Claude, so your own Claude writes the answers to your applications' written questions.",
};

/**
 * /docs/mcp: the connector's public documentation (KAN-383), the page
 * Anthropic's connector directory asks for: what the connector does, how
 * to add it, its tools and prompt, and how to remove it. Every line is a
 * claim about backend/app/connector/ (auto-apply/architecture.md, 14.6);
 * change the two together. The same readable column as /privacy, in the
 * type tokens (docs/design.md): heading for the page, subtitle for each
 * section, body for the text.
 */
export default function McpDocsPage() {
  return (
    <main id="main" className="flex-1">
      <article className="text-ink-muted text-body [&_a]:text-brand [&_code]:text-ink [&_h2]:text-ink [&_h2]:text-subtitle [&_strong]:text-ink mx-auto w-full max-w-3xl px-6 pt-12 pb-20 sm:px-10 [&_a]:underline [&_h2]:mt-10 [&_li]:mt-2 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6">
        <h1 className="text-heading text-ink">WorkIt Connector for Claude</h1>
        <p>
          WorkIt fills your job applications in Chrome. The connector lets your own Claude write the
          answers to their written questions, such as &quot;Why do you want to work here?&quot;.
          Claude reads one application at a time and saves its answers to WorkIt, and the WorkIt
          extension fills each one into that application&apos;s open tab. WorkIt never submits an
          application: you review each one and submit it yourself.
        </p>

        <h2>What You Need</h2>
        <ul>
          <li>
            A WorkIt student account with your experiences added, and the WorkIt Chrome extension.
          </li>
          <li>
            A Claude account on any plan. Free plans can add one custom connector.
          </li>
        </ul>

        <h2>Add WorkIt to Claude</h2>
        <ol>
          <li>
            Open <a href={claudeConnectorLink()}>Add WorkIt to Claude</a> (Auto Apply in WorkIt has
            the same button). Claude opens its Add Custom Connector dialog with WorkIt&apos;s name
            and address filled in. Check them and continue.
          </li>
          <li>
            Click Connect. Claude sends you to WorkIt: sign in if asked, then click Allow.
          </li>
          <li>Claude lists WorkIt under its connectors. Turn it on in a chat if it is off.</li>
          <li>
            The first time Claude asks to use each of WorkIt&apos;s tools, choose{" "}
            <strong>Always allow</strong>. Otherwise Claude stops to ask before every answer it
            saves.
          </li>
        </ol>

        <h2>Use It</h2>
        <ol>
          <li>
            In WorkIt, pick jobs in Up Next and press Auto Apply. The extension fills your
            applications in tabs.
          </li>
          <li>
            In Claude, run WorkIt&apos;s prompt <strong>Write my WorkIt answers</strong>. Claude writes and saves the answers for up to 5 applications, then asks
            you to start a new chat for the next ones.
          </li>
          <li>
            Each answer appears in its tab. Read it, change what you want, and submit the
            application yourself.
          </li>
        </ol>

        <h2>Tools and Prompt</h2>
        <ul>
          <li>
            <code>get_next_application</code> (read-only): the next application with written
            questions still unanswered: its company, job title, job posting and questions, and your
            experience bank and skills. Claude runs it without asking.
          </li>
          <li>
            <code>save_answers</code> (writes): saves answers to that application&apos;s questions,
            all or none, for the extension to fill. It refuses an answer to a question the
            application doesn&apos;t ask, an empty one, or one over the form&apos;s length limit.
            Claude asks you before it first saves: choose <strong>Always allow</strong>, or it
            stops to ask at every answer.
          </li>
          <li>
            <code>save_fact_question</code> (writes): when an answer needs a fact your experiences
            don&apos;t hold, Claude asks you for it instead of making it up. The question shows on
            Written Answers and in the application&apos;s tab, and your answer is added to the
            experience it is about.
          </li>
          <li>
            <strong>Write my WorkIt answers</strong> (prompt): how Claude writes the answers: it
            plans each one from passages it quotes from your own experiences, the posting and the
            company&apos;s brief, which WorkIt checks, then writes it in your voice from those alone.
          </li>
        </ul>

        <h2>Your Data</h2>
        <p>
          Claude sees only what the tools above return. It never gets your contact details, your
          application answers (including self-identification answers) or your resume files. WorkIt
          calls no AI model for the connector and never reads your Claude conversations. See the{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>

        <h2>Remove It</h2>
        <p>
          In Claude, open Customize, then Connectors, and remove WorkIt. Deleting your WorkIt
          account also ends every connection.
        </p>
      </article>
    </main>
  );
}
