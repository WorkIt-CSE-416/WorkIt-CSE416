"""
Bring a student's Apply files into their WorkIt record, so WorkIt's forms
fill as completely as Apply's (models/CLAUDE.md, "The Fill engine's profile").

    uv run python -m app.scripts.import_apply_profile <applicant_id> <apply_dir>
    uv run python -m app.scripts.import_apply_profile <applicant_id> <apply_dir> --dry-run

`apply_dir` holds Apply's applicant-profile.yaml, policies.yaml and
answer-bank.yaml, already in the Fill engine's own shapes (Apply runs the
same engine). One run, in one transaction:

1. `fill_profile`: the profile, but `files` (its resume and transcript come
   as WorkIt's own rows, step 5);
2. `fill_policies`: only the policies the engine reads (ENGINE_POLICIES);
   Apply's run settings (caps, limits, schedules) stay Apply's;
3. `fill_answers`: every Answer bank entry, with the company it was first
   asked at (the answer bank keeps a company's answers to that company's
   forms). As in Apply, only an entry with `source: lisul` is the student's
   own words; Claude's drafts (`source: claude`, reviewed or not) come as
   their Claude's, so they pass Claude's checks and a form that bans AI text
   never takes them. A choice's entry (its options, or a list) is `choice`;
4. WorkIt's own fields from the profile's identity: name, contact email,
   phone, links, home location, and the education entry (the student's own,
   matched by school);
5. the resume the profile names, copied into LOCAL_FILES_DIR and made the
   default upload as `local:<file name>` (services/local_files.py): nothing
   goes to Storage. Without LOCAL_FILES_DIR it is left out. The unofficial
   transcript it names comes the same way, as the student's transcript document;
6-8. the student's own writing from story-bank.md as writing samples, voice.md
   as their style card, and company-briefs/ through WorkIt's own page check
   (scripts/import_apply_writing.py). The briefs' pages are read from the web.

Running it again on the same files changes nothing; an edited file's facts
replace the old ones. It refuses a database that is not on this computer:
the files hold a student's personal facts, which go to a local copy only.
It prints counts and field names, never a value.
"""

import argparse
import asyncio
import datetime
import json
import shutil
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_sessionmaker
from app.models.documents import Student_Document
from app.models.dto import bank_section, entry_end_kind
from app.models.profiles import Applicant_Profile
from app.models.resume import Resume
from app.schemas.bank import EntryFields
from app.schemas.profile import ApplicantProfileUpdate
from app.scripts import import_apply_writing
from app.services import bank, local_files
from app.services.names import join_name

PROFILE, POLICIES, ANSWERS = "applicant-profile.yaml", "policies.yaml", "answer-bank.yaml"
# The policies the Fill engine reads (fill-engine src/rules.ts, planner.ts).
ENGINE_POLICIES = (
    "compensation", "cover_letter", "cover_letter_never", "defense_roles", "high_stakes_job_systems", "how_heard",
    "marketing_opt_in", "sms_opt_in", "target_role_wordings", "tick_consent_when_true", "us_roles_only",
)
US = {"united states", "united states of america", "usa", "us"}


class ImportRefused(Exception):
    pass


@dataclass
class Report:
    profile_sections: list[str] = field(default_factory=list)
    policies: list[str] = field(default_factory=list)
    answers: int = 0
    fields: list[str] = field(default_factory=list)
    education: str | None = None  # "created" | "updated"
    resume: str | None = None  # the file name, or None when left out
    transcript: str | None = None  # the file name, or None when left out
    notes: list[str] = field(default_factory=list)
    samples: int = 0  # writing samples, from story-bank.md
    style_card: bool = False
    briefs: list[dict] = field(default_factory=list)  # per section: company, team, kept, dropped, saved, listed


def _read(path: Path) -> dict:
    data = yaml.safe_load(path.read_text()) if path.is_file() else None
    return data if isinstance(data, dict) else {}


def _plain(value: Any) -> Any:
    """As JSON holds it: a date as its ISO text."""
    return json.loads(json.dumps(value, default=lambda v: v.isoformat() if isinstance(v, datetime.date) else str(v)))


def _month(value: Any) -> datetime.date | None:
    try:
        year, month = str(value).split("-")[:2]
        return datetime.date(int(year), int(month), 1)
    except (ValueError, TypeError):
        return None


def _answers(entries: dict) -> dict:
    brought = {}
    for filed, entry in entries.items():
        if not isinstance(entry, dict) or entry.get("answer") in (None, "", []):
            continue
        answer = entry["answer"]
        answer = [str(a) for a in answer] if isinstance(answer, list) else str(answer)
        first = entry.get("first_seen") if isinstance(entry.get("first_seen"), dict) else {}
        # Apply's own rule (answer_bank.py, LISUL): only an answer the student
        # gave is theirs. A Claude draft stays Claude's even once reviewed.
        brought[str(entry.get("question") or filed).strip()] = {
            "answer": answer, "own": entry.get("source") == "lisul",
            "choice": isinstance(answer, list) or bool(entry.get("options")),
            "company": (str(first.get("company") or "").strip() or None),
        }
    return brought


def _home(place: Any) -> str | None:
    if not isinstance(place, dict):
        return None
    parts = [str(place.get(k) or "").strip() for k in ("city", "state")]
    country = str(place.get("country") or "").strip()
    if country and country.casefold() not in US:
        parts.append(country)
    return ", ".join(p for p in parts if p) or None


def _identity_fields(facts: dict) -> dict:
    identity = facts.get("identity") or {}
    links = facts.get("links") or {}
    return {k: v for k, v in {
        "first_name": identity.get("legal_first_name"),
        "middle_name": identity.get("legal_middle_name"),
        "last_name": identity.get("legal_last_name"),
        "contact_email": identity.get("email"),
        "phone_number": identity.get("phone"),
        "linkedin_url": links.get("linkedin_url"),
        "github_url": links.get("github_url"),
        "portfolio_url": links.get("portfolio_url"),
        "location": _home(identity.get("current_location")),
    }.items() if v not in (None, "")}


async def _set_fields(profile: Applicant_Profile, facts: dict, report: Report) -> None:
    update = ApplicantProfileUpdate(**{k: str(v) for k, v in _identity_fields(facts).items()})
    for name in sorted(update.model_fields_set):
        value = getattr(update, name)
        if name in ("first_name", "middle_name", "last_name"):
            continue
        setattr(profile, name, value)
        report.fields.append(name)
    if update.first_name and update.last_name:
        full = join_name(update.first_name, update.middle_name, update.last_name)
        if len(full) > 50:
            report.notes.append("name left as it was: over 50 characters")
        else:
            profile.full_name, profile.first_name = full, update.first_name
            profile.middle_name, profile.last_name = update.middle_name, update.last_name
            report.fields.append("name")


async def _set_education(session: AsyncSession, applicant_id: uuid.UUID, facts: dict, report: Report) -> None:
    school = facts.get("education") or {}
    title = str(school.get("school") or "").strip()
    if not title:
        return
    majors = school.get("majors") or []
    end = _month(school.get("expected_graduation"))
    changes = {
        "section": bank_section.education, "title": title,
        "degree": school.get("degree_type") or school.get("degree"),
        "field_of_study": majors[0] if majors else None,
        "gpa": school.get("gpa_cumulative"), "gpa_scale": school.get("gpa_scale"),
        "start_month": _month(school.get("start_date")), "end_month": end,
        "end_kind": None if end is None else
        entry_end_kind.expected if end >= datetime.datetime.now(datetime.UTC).date().replace(day=1) else entry_end_kind.month,
    }
    found = await bank.find_duplicate(session, applicant_id, bank_section.education, title, None)
    if found is None:
        await bank.create_entry(session, applicant_id, EntryFields.model_validate(changes))
        report.education = "created"
    else:
        await bank.update_entry(session, applicant_id, found.row.id, changes)
        report.education = "updated"


async def _set_resume(
    session: AsyncSession, profile: Applicant_Profile, apply_dir: Path, facts: dict, report: Report,
) -> None:
    named = (facts.get("files") or {}).get("resume_pdf")
    if not named:
        return
    source = (apply_dir / str(named)).resolve()
    folder = get_settings().local_files_dir
    if folder is None:
        report.notes.append("resume left out: set LOCAL_FILES_DIR to attach it from this computer")
        return
    if not source.is_file():
        report.notes.append("resume left out: the file the profile names is missing")
        return
    folder.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, folder / source.name)
    path = local_files.local_path(source.name)
    resume = await session.scalar(select(Resume).where(Resume.applicant_id == profile.id, Resume.storage_path == path))
    if resume is None:
        resume = Resume(id=uuid.uuid4(), applicant_id=profile.id, original_filename=source.name, storage_path=path)
        session.add(resume)
        await session.flush()
    profile.default_resume_id, profile.default_built_resume_id = resume.id, None
    report.resume = source.name


async def _set_transcript(
    session: AsyncSession, profile: Applicant_Profile, apply_dir: Path, facts: dict, report: Report,
) -> None:
    """The unofficial transcript the profile names, copied into LOCAL_FILES_DIR like the resume
    and kept as the student's transcript document; never sent to Storage."""
    named = (facts.get("files") or {}).get("unofficial_transcript_pdf")
    if not named:
        return
    source = (apply_dir / str(named)).resolve()
    folder = get_settings().local_files_dir
    if folder is None:
        report.notes.append("transcript left out: set LOCAL_FILES_DIR to attach it from this computer")
        return
    if not source.is_file():
        report.notes.append("transcript left out: the file the profile names is missing")
        return
    folder.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, folder / source.name)
    document = await session.get(Student_Document, (profile.id, "transcript"))
    if document is None:
        document = Student_Document(applicant_id=profile.id, kind="transcript")
        session.add(document)
    document.original_filename, document.storage_path = source.name, local_files.local_path(source.name)
    report.transcript = source.name


async def import_apply(session: AsyncSession, applicant_id: uuid.UUID, apply_dir: Path) -> Report:
    """Steps 1-8 of the module docstring in the caller's session; flushes, never commits."""
    profile = await session.get(Applicant_Profile, applicant_id)
    if profile is None:
        raise ImportRefused(f"No applicant {applicant_id}.")
    facts = _read(apply_dir / PROFILE)
    if not facts:
        raise ImportRefused(f"No {PROFILE} in {apply_dir}.")
    policies = _read(apply_dir / POLICIES)
    report = Report()

    profile.fill_profile = _plain({k: v for k, v in facts.items() if k != "files"})
    profile.fill_policies = _plain({k: policies[k] for k in ENGINE_POLICIES if k in policies})
    profile.fill_answers = _plain(_answers(_read(apply_dir / ANSWERS)))
    report.profile_sections = sorted(profile.fill_profile)
    report.policies = sorted(profile.fill_policies)
    report.answers = len(profile.fill_answers)

    await _set_fields(profile, facts, report)
    await _set_education(session, applicant_id, facts, report)
    await _set_resume(session, profile, apply_dir, facts, report)
    await _set_transcript(session, profile, apply_dir, facts, report)
    await _set_writing(session, applicant_id, apply_dir, report)
    await session.flush()
    return report


async def _set_writing(session: AsyncSession, applicant_id: uuid.UUID, apply_dir: Path, report: Report) -> None:
    report.samples = await import_apply_writing.set_samples(session, applicant_id, apply_dir)
    left_out = await import_apply_writing.set_style_card(session, applicant_id, apply_dir)
    report.style_card = left_out is None and (apply_dir / import_apply_writing.VOICE).is_file()
    report.notes += [left_out] if left_out else []
    report.briefs = await import_apply_writing.set_briefs(session, apply_dir)


def _local(url: str) -> bool:
    return (urlsplit(url).hostname or "") in ("localhost", "127.0.0.1", "::1")


async def _run(applicant_id: uuid.UUID, apply_dir: Path, *, dry_run: bool) -> Report:
    async with get_sessionmaker()() as session:
        report = await import_apply(session, applicant_id, apply_dir)
        await (session.rollback() if dry_run else session.commit())
        return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("applicant_id", type=uuid.UUID)
    parser.add_argument("apply_dir", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="run every step, then roll back")
    args = parser.parse_args(argv)
    if not _local(get_settings().app_url):
        print("DATABASE_URL is not on this computer: the import writes only to a local database.", file=sys.stderr)
        return 2
    try:
        report = asyncio.run(_run(args.applicant_id, args.apply_dir.resolve(), dry_run=args.dry_run))
    except ImportRefused as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"{'DRY RUN, rolled back: ' if args.dry_run else ''}imported into applicant {args.applicant_id}")
    print(f"  fill profile sections: {', '.join(report.profile_sections)}")
    print(f"  fill policies: {', '.join(report.policies) or 'none'}")
    print(f"  saved answers: {report.answers}")
    print(f"  WorkIt fields set: {', '.join(report.fields) or 'none'}")
    print(f"  education entry: {report.education or 'none'}")
    print(f"  resume: {report.resume or 'left out'}")
    print(f"  transcript: {report.transcript or 'left out'}")
    print(f"  writing samples: {report.samples}")
    print(f"  style card: {'saved' if report.style_card else 'none'}")
    for b in report.briefs:
        name = b["company"] + (f" / team {b['team']}" if b["team"] else "")
        print(f"  brief {name}: {b['kept']} facts passed, {b['dropped']} dropped, {'kept' if b['saved'] else 'not kept'}"
              + ("" if b["listed"] else " (no WorkIt posting or company goes by this name)"))
    for note in report.notes:
        print(f"  note: {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
