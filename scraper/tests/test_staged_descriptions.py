"""Inline eligibility must survive expensive parsing, display caps and storage."""

import json
from dataclasses import replace

import pytest

from workit_scraper import __main__, feed, providers, store
from workit_scraper.providers import Job, text
from workit_scraper.shortlist import classify_job, classify_with_description, pick


def listing(title, markup):
    tags, page = text._listing_page(title, markup)
    return Job(
        "lever",
        "example",
        "Example",
        "1",
        title,
        "https://example.test/1",
        page=page,
        shortlist_tags=tags,
    )


@pytest.mark.parametrize(
    "title",
    ["Senior Software Engineer", "Software Engineering Lead", "Specialist", "University Recruiter"],
)
def test_rejected_title_never_parses_html(monkeypatch, title):
    def fail(*args, **kwargs):
        pytest.fail("rejected title parsed its description")

    monkeypatch.setattr(text, "_TextOnly", fail)
    job = listing(title, "<p>No experience required</p>")
    assert job.page is None
    assert not classify_job(job)


@pytest.mark.parametrize(
    "markup,kept",
    [
        ("<p>0 to 1 year of experience.</p>", True),
        ("<p>0&ndash;2 years of experience.</p>", True),
        ("<p>No <b>prior</b> experience required.</p>", True),
        ("&lt;p&gt;No experience required.&lt;/p&gt;", True),
        ("<p>5+ years of backend experience, including 1+ years with Kubernetes.</p>", False),
        ("<p>3+ years of experience.</p>", False),
        (None, False),
    ],
)
def test_fallback_and_minimum_years_guard(markup, kept):
    job = listing("Software Engineer", markup)
    assert bool(classify_job(job)) is kept
    assert (job.page is not None) is kept


def test_rejected_experience_skips_full_parse(monkeypatch):
    def fail(*args, **kwargs):
        pytest.fail("rejected experience extracted card facts or HTML roles")

    monkeypatch.setattr(text, "_described", fail)
    assert listing("Software Engineer", "5+ years of experience.").page is None


def test_title_keeps_precedence_and_card_facts():
    job = listing("Software Engineer Intern", "<p>5+ years of experience.</p>")
    assert classify_job(job)[0] == "intern"
    assert job.facts.min_years == 5


def test_requirement_beyond_cap_survives_store_metrics_and_render(tmp_path):
    markup = "<p>" + "Build software systems. " * 500 + "</p><p>0-1 years of experience.</p>"
    job = listing("Software Engineer", markup)
    assert "0-1" not in job.description
    assert not classify_with_description(job.title, job.description)
    assert classify_job(job)
    now = "2026-10-30T12:00:00+00:00"
    run = store.update(None, [job], [job.board_key], store.RunStats(), now)
    path = tmp_path / "jobs.json"
    store.save(run, path)
    restored = store.load(path)
    saved = restored.jobs[0]
    assert saved.shortlist_tags == job.shortlist_tags
    assert __main__.widening([saved])["kept"] == 1
    roles = pick(restored.jobs, is_new=restored.is_new)
    assert len(roles) == 1
    assert feed.closings(restored, roles) == {}
    assert feed.closings(restored, []) == {job.apply_url: "replaced"}


def test_high_requirement_beyond_cap_overrides_no_experience_phrase():
    markup = "<p>No experience required. " + "Build software systems. " * 500
    markup += "</p><p>5+ years of professional experience required.</p>"
    full, roles = text._described(markup)
    old_page = text._page("Software Engineer", full, roles=roles)
    assert classify_with_description("Software Engineer", old_page.description)
    assert old_page.facts.min_years == 5
    job = listing("Software Engineer", markup)
    assert not classify_job(job)
    assert __main__.widening([job]) == {"kept": 0, "no_stage": 1, "senior": 0}


def test_rejection_does_not_reuse_previous_page():
    old = listing("Software Engineer", "No experience required.")
    new = listing("Software Engineer", "5+ years of experience.")
    carried = store.carry(new, {old.key: old})
    assert carried.page is None
    assert not classify_job(carried)
    assert Job.from_row(json.loads(json.dumps(carried.to_row()))).shortlist_tags == ()


def test_legacy_rows_and_detail_readers_still_classify():
    job = listing("Software Engineer", "No experience required.")
    row = job.to_row()
    del row["shortlist_tags"]
    legacy = Job.from_row(row)
    assert legacy.shortlist_tags is None
    assert classify_job(legacy) == classify_job(job)
    detail = replace(legacy, ats="greenhouse", page=None)
    assert store.carry(detail, {detail.key: replace(legacy, ats="greenhouse")}).page == legacy.page


@pytest.mark.parametrize("ats", ["ashby", "lever", "recruitee", "tiktok", "jibe"])
def test_inline_provider_retains_all_ids_but_only_builds_kept_pages(monkeypatch, ats):
    titles = ["Software Engineer Intern", "Software Engineer", "Senior Software Engineer"]
    rows = [
        dict(
            id=str(i),
            title=title,
            text=title,
            description="No experience required.",
            descriptionPlain="No experience required.",
            slug=str(i),
            ats_code="icims",
        )
        for i, title in enumerate(titles)
    ]
    payloads = {
        "ashby": {"jobs": rows},
        "lever": rows,
        "recruitee": {"offers": rows},
        "tiktok": {"code": 0, "data": {"count": 3, "job_post_list": rows}},
        "jibe": {"totalCount": 3, "jobs": [{"data": row} for row in rows]},
    }
    monkeypatch.setattr(providers.fetch, "_get_json", lambda *a, **kw: payloads[ats])
    monkeypatch.setattr(providers.fetch, "_post_json", lambda *a, **kw: payloads[ats])
    jobs = providers.PROVIDERS[ats].read("example", "Example")
    assert [job.external_id for job in jobs] == ["0", "1", "2"]
    assert [bool(classify_job(job)) for job in jobs] == [True, True, False]
    assert [job.page is not None for job in jobs] == [True, True, False]
    assert __main__.widening(jobs) == {"kept": 2, "no_stage": 0, "senior": 1}


def test_changed_eligibility_keeps_two_complete_read_closing_rule():
    old = listing("Software Engineer", "No experience required.")
    run = store.update(None, [old], [old.board_key], store.RunStats(), "2026-10-30T09:00:00+00:00")
    for hour in (12, 15):
        changed = listing("Software Engineer", "5+ years of experience.")
        changed = store.carry(changed, {job.key: job for job in run.jobs})
        fresh = [changed] if classify_job(changed) else []
        run = store.update(
            run, fresh, [old.board_key], store.RunStats(), f"2026-10-30T{hour}:00:00+00:00"
        )
        roles = pick([job for job in run.jobs if run.is_listed(job)], is_new=run.is_new)
        assert bool(roles) is (hour == 12)
    assert feed.closings(run, roles) == {old.apply_url: "gone_from_board"}
