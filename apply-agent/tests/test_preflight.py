"""`apply preflight` (KAN-668): the plan from the links alone. No browser, and no connection at all."""

import socket
from types import SimpleNamespace

import pytest

from apply import cli, preflight
from apply.keychain import InMemoryKeychain

WORKDAY = "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/NY/Intern_R1"
WORKDAY_2 = "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/NY/Intern_R2"
OTHER_TENANT = "https://globex.wd1.myworkdayjobs.com/en-US/Jobs/job/CA/Intern_R3"
GREENHOUSE = "https://job-boards.greenhouse.io/acme/jobs/123"
LEVER = "https://jobs.lever.co/acme/abc-def"
ICIMS = "https://careers-acme.icims.com/jobs/1/x/job"
TIKTOK = "https://lifeattiktok.com/position/1"
UNKNOWN = "https://careers.example.com/jobs/1"
SMART = "https://jobs.smartrecruiters.com/Acme/7440"


@pytest.fixture(autouse=True)
def no_connection(monkeypatch):
    """Any socket at all fails the test: preflight reads no job site."""
    def refuse(*args, **kwargs):
        raise AssertionError("preflight opened a connection")
    monkeypatch.setattr(socket.socket, "connect", refuse)


def by_name(sites):
    return {site.name: site for site in sites}


def test_links_group_by_site_and_each_says_what_sign_in_it_needs():
    sites = by_name(preflight.group([WORKDAY, WORKDAY_2, OTHER_TENANT, GREENHOUSE, LEVER, ICIMS, TIKTOK, UNKNOWN],
                                    keychain=[], signed_in=[], profiles=True))
    assert sites["acme.wd5.myworkdayjobs.com"].links == [WORKDAY, WORKDAY_2]
    assert sites["acme.wd5.myworkdayjobs.com"].need == preflight.Need.YES
    assert sites["globex.wd1.myworkdayjobs.com"].need == preflight.Need.YES
    assert sites["job-boards.greenhouse.io"].need == preflight.Need.NO
    assert sites["jobs.lever.co"].job_system == "lever" and sites["jobs.lever.co"].need == preflight.Need.NO
    assert sites["careers-acme.icims.com"].need == preflight.Need.YES
    assert sites["lifeattiktok.com"].job_system == "TikTok" and sites["lifeattiktok.com"].need == preflight.Need.YES
    assert sites["careers.example.com"].need == preflight.Need.UNKNOWN


def test_a_link_given_twice_counts_once():
    assert by_name(preflight.group([LEVER, LEVER], [], [], True))["jobs.lever.co"].links == [LEVER]


def test_keychain_and_a_signed_in_profile_are_per_site():
    tenant, wall = "acme.wd5.myworkdayjobs.com", "careers-acme.icims.com"
    sites = by_name(preflight.group([WORKDAY, OTHER_TENANT, ICIMS], keychain=[tenant], signed_in=[wall], profiles=True))
    assert sites[tenant].keychain and not sites[tenant].profile
    assert sites["globex.wd1.myworkdayjobs.com"].keychain is False
    assert sites[wall].profile and not sites[wall].keychain


def test_a_noted_sign_in_with_no_worker_profile_left_is_no_signed_in_profile():
    wall = "careers-acme.icims.com"
    assert not by_name(preflight.group([ICIMS], [], signed_in=[wall], profiles=False))[wall].profile


def test_a_keychain_it_could_not_read_says_so_and_counts_as_no_item():
    sites = preflight.group([WORKDAY], keychain=None, signed_in=[], profiles=True)
    assert sites[0].keychain is None and not sites[0].ready
    assert "can't read" in preflight.report(sites, 3, mail=False, mode="cdp")


def test_without_gmail_the_sign_ins_to_do_first_come_before_the_plan_with_their_commands():
    sites = preflight.group([GREENHOUSE, ICIMS], [], [], True)
    said = preflight.report(sites, 3, mail=False, mode="cdp")
    assert said.index("Sign-ins to do first") < said.index("Order and pacing")
    first = said[said.index("Sign-ins to do first"):said.index("Order and pacing")]
    assert f"uv run apply sign-in {ICIMS}" in first and GREENHOUSE not in first


def test_a_site_apply_can_sign_in_to_itself_is_no_sign_in_to_do_first():
    tenant = "acme.wd5.myworkdayjobs.com"
    with_password = preflight.report(preflight.group([WORKDAY], [tenant], [], True), 3, mail=False, mode="cdp")
    assert "Sign-ins to do first:\n  None." in with_password and "password in Keychain" in with_password
    with_mail = preflight.report(preflight.group([WORKDAY], [], [], True), 3, mail=True, mode="cdp")
    assert "Sign-ins to do first:\n  None." in with_mail and "reads its code from Gmail" in with_mail


def test_plain_workers_get_one_site_each_and_later_links_go_into_the_same_worker():
    sites = preflight.group([GREENHOUSE, WORKDAY, WORKDAY_2, LEVER], [], [], True)
    said = preflight.report(sites, 2, mail=True, mode="plain")
    assert f"uv run apply rehearse --workers 2 {WORKDAY} {GREENHOUSE}\n" in said
    assert f"--into PORT:1 {WORKDAY_2}" in said  # its sign-in holds in Browser 1
    assert f"--into PORT:1 {LEVER}" in said  # a third site, on Browser 1 in its turn


def test_cdp_workers_get_one_command_with_sites_taking_turns_and_no_timed_waits():
    sites = preflight.group([WORKDAY, WORKDAY_2, GREENHOUSE], [], [], True)
    said = preflight.report(sites, 3, mail=True, mode="cdp")
    assert f"uv run apply rehearse --workers 2 {WORKDAY} {GREENHOUSE} {WORKDAY_2}" in said
    assert "--into" not in said and "no timed waits" in said


def test_a_bot_checked_host_says_it_needs_a_plain_worker_when_workers_are_cdp():
    sites = preflight.group([SMART], [], [], True, bot_checked=["smartrecruiters.com"])
    assert "needs a plain Worker" in preflight.report(sites, 1, mail=True, mode="cdp")
    assert "needs a plain Worker" not in preflight.report(sites, 1, mail=True, mode="protected")


def test_the_command_reads_no_job_site_and_opens_no_browser(monkeypatch, capsys):
    class Site:
        def signed_in(self):
            return frozenset()

        def __getattr__(self, name):
            raise AssertionError(f"preflight used the job site adapter's {name}")

    adapters = SimpleNamespace(keychain=InMemoryKeychain({"acme.wd5.myworkdayjobs.com": "unread"}), site=Site())
    monkeypatch.setattr(cli, "_gmail_set_up", lambda: False)
    cli.main(["preflight", WORKDAY, ICIMS], adapters=adapters)
    said = capsys.readouterr().out
    assert "acme.wd5.myworkdayjobs.com" in said and "Sign-ins to do first" in said and "read no job site" in said
    assert f"apply sign-in {ICIMS}" in said


@pytest.mark.parametrize("given", ["not a link", f"{LEVER} {GREENHOUSE}"])
def test_a_thing_that_is_no_one_link_is_refused(capsys, given):
    with pytest.raises(SystemExit):
        cli.main(["preflight", given], adapters=object())
    assert "not a link" in capsys.readouterr().err
