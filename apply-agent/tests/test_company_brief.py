"""Company brief: what a company and the team a Posting is for build,
researched on the web, each fact checked against its own page, and kept per
section: 90 days for the company, 30 for a team."""

import threading
import urllib.error
from datetime import date

from fakes import FakeClaude

from apply import brief, essays
from apply.adapters import Drive
from apply.claude_cli import ClaudeError
from apply.model import Posting, Question

CLOUDFLARE = Posting("gh", "Cloudflare", "Software Engineer Intern", "https://job-boards.greenhouse.io/cloudflare/jobs/1")
TODAY = date(2026, 10, 19)
EMDASH = {"name": "EmDash", "month": "2026-04", "url": "https://blog.cloudflare.com/emdash/",
          "quote": "The spiritual successor to   WordPress.", "fact": "EmDash is an open-source CMS that runs on Workers and isolates each plugin in its own sandbox."}
X402 = {"name": "x402", "url": "https://blog.cloudflare.com/x402/", "quote": "Launching the x402 Foundation",
        "fact": "x402 lets an AI agent pay for a web request over HTTP with the 402 status code."}
WORKERD = {"name": "workerd", "url": "https://github.com/cloudflare/workerd",
           "quote": "the javascript / wasm runtime", "fact": "workerd is the open-source JavaScript and Wasm runtime that runs Cloudflare Workers."}


class Site:
    """Company pages as a map of URL to body; any other URL fails, as a dead link does."""

    def __init__(self, pages: dict[str, str]):
        self.pages = pages
        self.fetched: list[str] = []

    def fetch(self, url, body=None):
        self.fetched.append(url)
        if self.pages.get(url) == 403:  # a site that blocks plain fetches (Shield AI, Citadel)
            raise urllib.error.HTTPError(url, 403, "Forbidden", {}, None)
        if url not in self.pages:
            raise OSError(f"no page at {url}")
        return self.pages[url].encode()


PAGES = Site({EMDASH["url"]: "<h1>Introducing EmDash</h1><p>The spiritual successor to WordPress.</p>",
              X402["url"]: "<h1>Launching the x402 Foundation with Coinbase</h1>",
              WORKERD["url"]: "<h1>workerd</h1><p>The JavaScript / Wasm runtime that powers Cloudflare Workers</p>"})


def kept() -> str:
    return (brief.BRIEFS / "cloudflare.md").read_text()


def test_a_brief_names_what_the_company_builds_with_each_facts_page():
    claude = FakeClaude(brief=[EMDASH, X402])

    facts = brief.brief(CLOUDFLARE, PAGES, claude, TODAY)

    assert facts.splitlines() == [
        "Company:",
        "- **EmDash** (2026-04): EmDash is an open-source CMS that runs on Workers and isolates each plugin in its own"
        " sandbox. https://blog.cloudflare.com/emdash/",
        "- **x402**: x402 lets an AI agent pay for a web request over HTTP with the 402 status code."
        " https://blog.cloudflare.com/x402/",
    ]
    [prompt] = claude.researched
    assert prompt == "<company>Cloudflare</company>"


def test_the_research_puts_engineering_facts_before_the_headline_launches():
    assert brief.SYSTEM.index("engineering facts") < brief.SYSTEM.index("product facts")
    assert "headline" in brief.SCHEMA["properties"]["facts"]["items"]["properties"]
    assert "intern" in brief.SYSTEM and "founder" in brief.SYSTEM  # their projects and technical bets are wanted
    assert "anything about hiring" not in brief.SYSTEM and "personal lives" in brief.SYSTEM


def test_each_fact_notes_its_kind_and_a_headline_launch_says_so():
    engineering = dict(WORKERD, type="engineering")
    launch = dict(EMDASH, type="product", headline=True)

    facts = brief.brief(CLOUDFLARE, PAGES, FakeClaude(brief=[engineering, launch]), TODAY)

    assert facts.splitlines()[1:] == [
        f"- **workerd** (engineering): {WORKERD['fact']} {WORKERD['url']}",
        f"- **EmDash** (2026-04, product, headline): {EMDASH['fact']} {EMDASH['url']}",
    ]


ABOUT = "https://www.cloudflare.com/about/"
CULTURE = "https://www.cloudflare.com/culture/"
VALUED = Site(PAGES.pages | {
    ABOUT: "<h2>Our mission</h2><p>Our mission is to help build a better Internet.</p>",
    CULTURE: "<li><b>Principled</b>: we do the right thing.</li><li>Curious.</li>"})


def test_the_company_section_copies_its_mission_and_values_word_for_word_and_says_what_kind_it_is():
    found = {"facts": [EMDASH], "company_kind": "big-tech",
             "mission": {"text": "Our mission is to help build a better Internet.", "url": ABOUT},
             "values": [{"text": "Principled: we do the right thing.", "url": CULTURE},
                        {"text": "Bold: we take big swings.", "url": CULTURE},  # not on the page: made up
                        {"text": "Curious.", "url": CULTURE}]}

    facts = brief.brief(CLOUDFLARE, VALUED, FakeClaude(brief=found), TODAY)

    assert facts.splitlines() == [
        "Company:",
        "Kind of company: big-tech",
        f'Mission, word for word: "Our mission is to help build a better Internet." {ABOUT}',
        "Values, word for word:",
        f'- "Principled: we do the right thing." {CULTURE}',
        f'- "Curious." {CULTURE}',
        f"- **EmDash** (2026-04): {EMDASH['fact']} {EMDASH['url']}",
    ]
    assert essays.named_fact("Principled", facts) == ""
    assert "Kind of company: big-tech" in kept()


def test_a_mission_its_page_does_not_hold_is_left_out_and_a_blocked_one_is_marked_unchecked():
    made_up = {"facts": [], "company_kind": "rocket-ship", "mission": {"text": "To be the best.", "url": ABOUT},
               "values": [{"text": "Curious.", "url": "https://www.cloudflare.com/blocked/"}]}

    facts = brief.brief(CLOUDFLARE, Site(VALUED.pages | {"https://www.cloudflare.com/blocked/": 403}),
                        FakeClaude(brief=made_up), TODAY)

    assert facts.splitlines() == ["Company:", "Kind of company: other", "Values, word for word:",
                                  '- "Curious." https://www.cloudflare.com/blocked/ (unchecked: its page blocks reading)']


def test_the_research_asks_for_the_mission_and_values_only_of_the_company():
    assert "word for word" in brief.SYSTEM and "values" in brief.SCHEMA["properties"]
    assert brief.SCHEMA["properties"]["company_kind"]["enum"] == [
        "big-tech", "startup", "quant", "defense", "ai-lab", "edtech", "other"]


def test_each_fact_shows_up_to_three_problem_tags_from_the_fixed_list():
    tagged = dict(WORKERD, type="engineering", tags=["developer-tools", "made-up", "security", "web-product",
                                                    "distributed-systems"])
    untagged = dict(EMDASH, tags=[])

    facts = brief.brief(CLOUDFLARE, PAGES, FakeClaude(brief=[tagged, untagged]), TODAY)

    assert facts.splitlines()[1:] == [
        f"- **workerd** (engineering; tags: developer-tools, security, web-product): {WORKERD['fact']} {WORKERD['url']}",
        f"- **EmDash** (2026-04): {EMDASH['fact']} {EMDASH['url']}",
    ]
    assert essays.named_fact("workerd", facts).startswith("**workerd** (engineering; tags:")


def test_the_research_tags_each_fact_from_the_story_banks_kinds_of_problem():
    tags = brief.SCHEMA["properties"]["facts"]["items"]["properties"]["tags"]
    assert tags["items"]["enum"] == list(brief.TAGS) and tags["maxItems"] == 3
    assert {"real-time-data", "fleet-tracking", "embedded-control", "computer-vision", "web-scraping"} <= set(brief.TAGS)


VALUES_Q = Question("q1", "Which of Cloudflare's values resonates with you most, and why?", "textarea")
BUILD_Q = Question("q2", "What would you build at Cloudflare?", "textarea")
TRACK_Q = Question("q3", "Which team would you prefer?", "select", options=("Runtime", "Security"))
WHY_Q = Question("q4", "Why Cloudflare?", "textarea")
DOCS = "https://developers.cloudflare.com/workers/limits/"
TEAMS = "https://www.cloudflare.com/careers/teams/"
ASKED = Site(VALUED.pages | {
    DOCS: "<p>Workers can't yet hold a socket open past 30 seconds.</p>",
    TEAMS: "<p>Runtime builds workerd, the open-source runtime.</p><p>Security keeps customers safe.</p>"})


def test_a_form_with_no_values_build_or_preference_question_gets_the_usual_research():
    claude = FakeClaude(brief=[EMDASH])

    brief.brief(CLOUDFLARE, PAGES, claude, TODAY, questions=[WHY_Q])

    assert claude.researched == ["<company>Cloudflare</company>"]


def test_a_build_and_a_preference_question_get_the_problems_and_tracks_the_company_states():
    found = {"facts": [EMDASH],
             "problems": [{"text": "Workers can't yet hold a socket open past 30 seconds.", "url": DOCS},
                          {"text": "Workers will soon run Python everywhere.", "url": DOCS}],  # not on the page
             "tracks": [{"name": "Runtime", "text": "Runtime builds workerd, the open-source runtime.", "url": TEAMS}]}
    claude = FakeClaude(brief=found)

    facts = brief.brief(CLOUDFLARE, ASKED, claude, TODAY, questions=[BUILD_Q, TRACK_Q, WHY_Q])

    [prompt] = claude.researched
    assert prompt.startswith("<company>Cloudflare</company>\n<asks>") and "Problems it states itself" in prompt
    assert "What would you build at Cloudflare?" in prompt and "Runtime | Security" in prompt
    assert "Why Cloudflare?" not in prompt and "values or principles" not in prompt.split("<asks>")[1]
    lines = facts.splitlines()
    at = lines.index("Problems it states, word for word:")
    assert lines[at:at + 4] == [
        "Problems it states, word for word:",
        f'- "Workers can\'t yet hold a socket open past 30 seconds." {DOCS}',
        "Teams and tracks, word for word:",
        f'- Runtime: "Runtime builds workerd, the open-source runtime." {TEAMS}',
    ]
    assert "Python" not in facts


def test_a_values_question_the_research_finds_no_values_for_is_not_researched_again_each_time():
    brief.brief(CLOUDFLARE, ASKED, FakeClaude(brief=[EMDASH]), TODAY, questions=[VALUES_Q])
    again = FakeClaude(brief=[X402])

    facts = brief.brief(CLOUDFLARE, ASKED, again, TODAY, questions=[VALUES_Q])

    assert again.researched == [] and "Values, word for word: none found" in facts


def test_a_kept_company_section_is_researched_again_when_a_form_asks_what_it_lacks():
    brief.brief(CLOUDFLARE, ASKED, FakeClaude(brief=[EMDASH]), TODAY)
    asked = FakeClaude(brief={"facts": [EMDASH], "problems": [
        {"text": "Workers can't yet hold a socket open past 30 seconds.", "url": DOCS}]})

    facts = brief.brief(CLOUDFLARE, ASKED, asked, TODAY, questions=[BUILD_Q])

    assert len(asked.researched) == 1 and "past 30 seconds" in facts


def test_one_page_gives_at_most_two_facts():
    page = Site({EMDASH["url"]: "<p>Alpha, Beta and Gamma ship today.</p>"})
    recap = [dict(EMDASH, name=n, quote=f"{n}", fact=f"{n} ships.") for n in ("Alpha", "Beta", "Gamma")]

    facts = brief.brief(CLOUDFLARE, page, FakeClaude(brief=recap), TODAY)

    assert "Alpha" in facts and "Beta" in facts and "Gamma" not in facts


def test_a_fact_whose_quote_is_not_on_its_page_is_dropped_as_made_up():
    made_up = {"name": "Workers Quantum", "url": EMDASH["url"], "quote": "Workers Quantum runs on qubits",
               "fact": "Workers Quantum runs code on qubits."}
    dead_link = {"name": "Pipelines", "url": "https://blog.cloudflare.com/gone/", "quote": "Pipelines",
                 "fact": "Pipelines streams events."}
    no_quote = dict(X402, quote="")

    facts = brief.brief(CLOUDFLARE, PAGES, FakeClaude(brief=[EMDASH, made_up, dead_link, no_quote]), TODAY)

    assert "EmDash" in facts and "Workers Quantum" not in facts and "Pipelines" not in facts and "x402" not in facts


def test_every_number_in_a_fact_must_be_in_its_quote():
    page = Site({EMDASH["url"]: "<p>EmDash serves 1,750 sites in under 2 ms.</p>"})
    quoted = dict(EMDASH, quote="EmDash serves 1,750 sites in under 2 ms.", fact="EmDash serves 1750 sites in 2 ms.")
    unquoted = dict(EMDASH, name="EmDash CLI", quote="EmDash serves 1,750 sites",
                    fact="EmDash CLI serves 1,750 sites with 3,000 commands.")

    facts = brief.brief(CLOUDFLARE, page, FakeClaude(brief=[quoted, unquoted]), TODAY)

    assert "1750 sites" in facts and "3,000" not in facts


def test_a_site_that_blocks_plain_fetches_keeps_its_facts_marked_unchecked_never_as_a_named_fact():
    numbered = dict(X402, url="https://blog.cloudflare.com/x402-2/", fact="x402 takes 3 lines.", quote="x402 is short")
    blocked = Site(PAGES.pages | {EMDASH["url"]: 403, numbered["url"]: 403})

    facts = brief.brief(CLOUDFLARE, blocked, FakeClaude(brief=[EMDASH, WORKERD, numbered]), TODAY)

    assert facts.splitlines() == [
        "Company:",
        f"- **workerd**: {WORKERD['fact']} {WORKERD['url']}",
        f"- EmDash (2026-04, unchecked: its page blocks reading): {EMDASH['fact']} {EMDASH['url']}",
    ]
    assert essays.named_fact("EmDash", facts) == "" and essays.named_fact("workerd", facts).startswith("**workerd**")


def test_the_research_quotes_each_facts_page():
    assert "quote" in brief.SCHEMA["properties"]["facts"]["items"]["required"]
    assert "copied exactly" in brief.SYSTEM


TECHCRUNCH_X402 = {"name": "x402", "kind": "press", "outlet": "TechCrunch", "month": "2026-05",
                   "quote": "Cloudflare and Coinbase launch x402", "url": "https://techcrunch.com/x402/", "fact": "x402 lets AI agents pay for web requests."}
PRESS_NUMBER = {"name": "Workers", "kind": "press", "outlet": "The Verge", "quote": "Workers is everywhere", "url": "https://theverge.com/workers/",
                "fact": "Workers runs code for 40% of the Fortune 500."}
PRESS = Site(PAGES.pages | {TECHCRUNCH_X402["url"]: "<h1>Cloudflare and Coinbase launch x402</h1>",
                            PRESS_NUMBER["url"]: "<h1>Cloudflare Workers is everywhere</h1>"})


def test_press_facts_stand_in_only_when_the_companys_own_pages_cant_be_read():
    own = [EMDASH, X402, WORKERD]

    with_own = brief.brief(CLOUDFLARE, PRESS, FakeClaude(brief=own + [TECHCRUNCH_X402]), TODAY)
    (brief.BRIEFS / "cloudflare.md").unlink()
    blocked = brief.brief(CLOUDFLARE, Site({k: v for k, v in PRESS.pages.items() if "cloudflare" not in k}),
                          FakeClaude(brief=own + [TECHCRUNCH_X402]), TODAY)

    assert "techcrunch" not in with_own
    assert blocked.splitlines() == ["Company:", "- **x402** (2026-05, press: TechCrunch): x402 lets AI agents pay for"
                                    " web requests. https://techcrunch.com/x402/"]


def test_a_press_fact_that_states_a_number_is_dropped():
    facts = brief.brief(CLOUDFLARE, PRESS, FakeClaude(brief=[EMDASH, PRESS_NUMBER, TECHCRUNCH_X402]), TODAY)

    assert "TechCrunch" in facts and "Fortune" not in facts


def test_the_research_asks_for_the_companys_own_pages_first_and_press_apart():
    assert 'Use the company\'s own pages first' in brief.SYSTEM and 'marked "press"' in brief.SYSTEM


def test_a_posting_for_a_named_team_gets_a_section_of_its_own_beside_the_company():
    claude = FakeClaude(brief=[EMDASH], team="Workers Runtime", team_brief=[WORKERD])

    facts = brief.brief(CLOUDFLARE, PAGES, claude, TODAY, "You'll join the Workers Runtime team, building workerd.")

    assert facts.split("\n\n") == [f"Company:\n- **EmDash** (2026-04): {EMDASH['fact']} {EMDASH['url']}",
                                   f"Team: Workers Runtime:\n- **workerd**: {WORKERD['fact']} {WORKERD['url']}"]
    assert claude.researched == ["<company>Cloudflare</company>",
                                 "<company>Cloudflare</company>\n<team>Workers Runtime</team>"]
    [named] = claude.teams_named
    assert "Software Engineer Intern" in named and "building workerd" in named
    assert "## Company\nResearched 2026-10-19" in kept() and "## Team: Workers Runtime\nResearched 2026-10-19" in kept()


def test_a_team_named_as_empty_quotes_is_no_team():
    claude = FakeClaude(brief=[EMDASH], team='""', team_brief=[WORKERD])

    facts = brief.brief(CLOUDFLARE, PAGES, claude, TODAY)

    assert facts.startswith("Company:") and "Team" not in facts
    assert claude.researched == ["<company>Cloudflare</company>"]


def test_a_team_named_as_the_company_itself_is_no_team():
    claude = FakeClaude(brief=[EMDASH], team="cloudflare, inc.", team_brief=[WORKERD])

    facts = brief.brief(CLOUDFLARE, PAGES, claude, TODAY)

    assert "Team" not in facts and claude.researched == ["<company>Cloudflare</company>"]
    assert brief.name_team(FakeClaude(team="Cloudflare"), CLOUDFLARE) == ""


def test_a_team_fact_the_company_section_already_has_is_shown_once():
    claude = FakeClaude(brief=[EMDASH, X402], team="Workers Runtime", team_brief=[dict(EMDASH, month=""), WORKERD])

    facts = brief.brief(CLOUDFLARE, PAGES, claude, TODAY)

    assert facts.count("**EmDash**") == 1 and "Team: Workers Runtime:\n- **workerd**" in facts
    assert kept().count("**EmDash**") == 1


def test_an_old_team_section_that_repeats_the_company_shows_nothing_of_its_own():
    brief.BRIEFS.mkdir(exist_ok=True)
    line = f"- **EmDash** (2026-04): {EMDASH['fact']} {EMDASH['url']}"
    (brief.BRIEFS / "cloudflare.md").write_text(
        f"# Cloudflare\n\n## Company\nResearched 2026-10-01\n\n{line}\n\n## Team: Runtime\nResearched 2026-10-01\n\n{line}\n")

    facts = brief.brief(CLOUDFLARE, PAGES, FakeClaude(team="Runtime"), TODAY)

    assert facts == f"Company:\n{line}"


def test_another_teams_posting_keeps_the_company_section_and_adds_its_own():
    brief.brief(CLOUDFLARE, PAGES, FakeClaude(brief=[EMDASH], team="Workers Runtime", team_brief=[WORKERD]), TODAY)
    security = FakeClaude(brief=[X402], team="Security", team_brief=[X402])

    facts = brief.brief(CLOUDFLARE, PAGES, security, TODAY)

    assert security.researched == ["<company>Cloudflare</company>\n<team>Security</team>"]
    assert "EmDash" in facts and "workerd" not in facts and "Team: Security:\n- **x402**" in facts
    assert "## Team: Workers Runtime" in kept()  # still kept for the next Workers posting


def test_a_brief_is_kept_for_lisul_to_read_and_edit_and_his_edits_stand():
    brief.brief(CLOUDFLARE, PAGES, FakeClaude(brief=[EMDASH, X402]), TODAY)
    assert kept().startswith("# Cloudflare\nEssays use each fact below as it is")
    x402 = next(line for line in kept().splitlines() if "x402" in line)
    (brief.BRIEFS / "cloudflare.md").write_text(kept().replace(x402 + "\n", ""))

    later = FakeClaude(brief=[X402])
    facts = brief.brief(CLOUDFLARE, PAGES, later, date(2027, 1, 16))

    assert later.researched == [] and "EmDash" in facts and "x402" not in facts


def test_the_company_section_is_researched_again_after_90_days_and_a_team_after_30():
    brief.brief(CLOUDFLARE, PAGES, FakeClaude(brief=[EMDASH], team="Workers Runtime", team_brief=[WORKERD]), TODAY)

    at_30 = FakeClaude(brief=[X402], team="workers runtime", team_brief=[WORKERD])
    brief.brief(CLOUDFLARE, PAGES, at_30, date(2026, 11, 18))
    at_90 = FakeClaude(brief=[X402])
    facts = brief.brief(CLOUDFLARE, PAGES, at_90, date(2027, 1, 17))

    assert at_30.researched == ["<company>Cloudflare</company>\n<team>workers runtime</team>"]
    assert kept().count("## Team:") == 1  # the same team, whatever its case
    assert at_90.researched == ["<company>Cloudflare</company>"] and "x402" in facts and "EmDash" not in facts


def test_a_deleted_section_is_researched_again():
    brief.brief(CLOUDFLARE, PAGES, FakeClaude(brief=[EMDASH]), TODAY)
    (brief.BRIEFS / "cloudflare.md").write_text("# Cloudflare\n")
    again = FakeClaude(brief=[X402])

    assert "x402" in brief.brief(CLOUDFLARE, PAGES, again, TODAY) and len(again.researched) == 1


class Failing(FakeClaude):
    def __init__(self, failure):
        super().__init__()
        self.failure = failure

    def research(self, **_):
        if isinstance(self.failure, Exception):
            raise self.failure
        return self.failure


def test_a_research_that_fails_or_passes_its_cap_keeps_the_old_brief_and_none_is_written():
    assert brief.brief(CLOUDFLARE, PAGES, Failing(ClaudeError("claude -p failed")), TODAY) == ""
    assert not (brief.BRIEFS / "cloudflare.md").exists()  # tried again next time
    brief.brief(CLOUDFLARE, PAGES, FakeClaude(brief=[EMDASH]), TODAY)

    facts = brief.brief(CLOUDFLARE, PAGES, Failing(Drive(None, 25, 1_500_000, capped=True)), date(2027, 6, 1))

    assert "EmDash" in facts


def test_a_research_that_finds_nothing_is_kept_so_it_is_not_repeated_every_application():
    brief.brief(CLOUDFLARE, PAGES, FakeClaude(), TODAY)
    again = FakeClaude(brief=[EMDASH])

    assert brief.brief(CLOUDFLARE, PAGES, again, TODAY) == "" and again.researched == []


def test_two_workers_on_one_company_research_it_once():
    claude = FakeClaude(brief=[EMDASH])
    threads = [threading.Thread(target=brief.brief, args=(CLOUDFLARE, PAGES, claude, TODAY)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(claude.researched) == 1


# A link that names no company (JPMorgan's Oracle site, amazon.jobs) once read company-briefs/company.md,
# another company's brief, so its facts could reach an essay.

def test_a_known_job_sites_host_names_its_company():
    from apply.model import host_company

    assert host_company("https://www.amazon.jobs/en/jobs/2981234/software-dev-engineer-intern") == "Amazon"
    assert host_company("https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210") \
        == "JPMorgan Chase"
    assert host_company("https://careers.amd.com/careers-home/jobs/12345") == "Advanced Micro Devices"
    assert host_company("https://careers-amd.icims.com/jobs/12345/job") == "Advanced Micro Devices"
    assert host_company("https://careers-other.icims.com/jobs/1/job") == ""
    assert host_company("https://apply.careers.microsoft.com/careers/job/1") == "Microsoft"
    assert host_company("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/x") == "NVIDIA"
    assert host_company("https://bankcampuscareers.tal.net/vx/candidate/apply/1") == "Bank of America"
    assert host_company("https://example.com/jobs/1") == ""


def test_a_posting_with_no_company_reads_no_brief_and_essays_get_a_note():
    brief.BRIEFS.mkdir(exist_ok=True)
    (brief.BRIEFS / "company.md").write_text("# \n\n## Company\nResearched 2026-10-18\n\n- **Other**: Not theirs. https://x/\n")
    nameless = Posting("r", "", "Intern", "https://example.com/jobs/1")
    claude = FakeClaude(brief=[EMDASH])

    assert brief.brief(nameless, PAGES, claude, TODAY) == brief.NO_COMPANY
    assert claude.researched == [] and "Other" not in brief.NO_COMPANY


def test_a_nameless_posting_on_a_known_host_gets_that_companys_brief():
    brief.BRIEFS.mkdir(exist_ok=True)
    (brief.BRIEFS / "amazon.md").write_text("# Amazon\n\n## Company\nResearched 2026-10-18\n\n"
                                           "- **Prime Air**: Amazon delivers by drone. https://amazon.com/air\n")
    amazon = Posting("r", "", "SDE Intern", "https://www.amazon.jobs/en/jobs/1/sde-intern")

    facts = brief.brief(amazon, PAGES, FakeClaude(), TODAY)

    assert "Prime Air" in facts


def test_a_brief_whose_heading_names_another_company_is_never_read_nor_written():
    brief.BRIEFS.mkdir(exist_ok=True)
    other = "# Not Cloudflare\n\n## Company\nResearched 2026-10-18\n\n- **Other**: Not theirs. https://x/\n"
    (brief.BRIEFS / "cloudflare.md").write_text(other)

    facts = brief.brief(CLOUDFLARE, PAGES, FakeClaude(brief=[EMDASH]), TODAY)

    assert "Other" not in facts and "EmDash" in facts
    assert kept() == other


def test_a_brief_is_found_by_its_heading_whatever_its_legal_suffix():
    brief.BRIEFS.mkdir(exist_ok=True)
    (brief.BRIEFS / "advanced-micro-devices-inc.md").write_text(
        "# Advanced Micro Devices, Inc\n\n## Company\nResearched 2026-10-18\n\n- **ROCm**: AMD's GPU stack. https://amd.com/rocm\n")
    amd = Posting("r", "", "Intern", "https://careers.amd.com/careers-home/jobs/1")
    claude = FakeClaude()

    assert "ROCm" in brief.brief(amd, PAGES, claude, TODAY) and claude.researched == []
