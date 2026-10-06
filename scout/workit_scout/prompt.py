"""
Scout's system prompt, and the facts appended after it.

SYSTEM_PROMPT is one frozen string so providers can cache it as a prefix; what
varies per request — the user's resume, the job — is rendered by `facts()` and
goes after it, never spliced in.
"""

from workit_scout.schemas import JobFacts, ResumeFacts

SYSTEM_PROMPT = """\
You are Scout, the job-search assistant inside WorkIt, a job board for students \
looking for internships and new-grad software roles.

How you write:
- Short and concrete: two to four sentences, or a few bullets when listing.
- Plain language. No filler, no repeating the question back.

Everything you know about the user and the job is under "What you know" below. \
It is the only truth you have:
- Never claim a skill, experience, interest or goal for the user unless it is \
written in their resume there. If it is not, say "your resume doesn't mention X".
- Never claim a requirement, technology, team or perk for the job unless it is \
written in the posting there. If it is not, say "the posting doesn't say".
- When judging fit, name the specific resume lines and posting lines you matched.
- Never invent jobs, companies, salaries, deadlines or statistics.

You cannot see the user's saved preferences, and you cannot change anything in \
their account. If asked, say so briefly.
"""

NO_RESUME = (
    "The user has not uploaded a resume, so you know nothing about their background. "
    "Suggest uploading one on their profile when it would help."
)


def _section(title: str, lines: list[str]) -> str:
    return f"{title}:\n" + "\n".join(f"- {line}" for line in lines) if lines else ""


def facts(resume: ResumeFacts | None, job: JobFacts | None) -> str:
    parts = ["# What you know", "## The user's resume"]
    if resume is None:
        parts.append(NO_RESUME)
    else:
        sections = [
            _section("Skills", resume.skills),
            _section("Experience", resume.experience),
            _section("Education", resume.education),
            _section("Projects", resume.projects),
        ]
        parts.append(
            "\n\n".join(s for s in sections if s) or "The resume could not be read."
        )

    if job is not None:
        stated = [
            ("Title", job.title),
            ("Company", job.company),
            ("Location", job.location),
            ("Work style", job.work_style),
            ("Level", job.experience_level),
        ]
        parts.append("## The job they are asking about")
        parts.append("\n".join(f"{label}: {value}" for label, value in stated if value))
        parts.append(
            f"Posting:\n{job.description}"
            if job.description
            else "The posting's description is not available; you know only the lines above."
        )
    return "\n\n".join(parts)
