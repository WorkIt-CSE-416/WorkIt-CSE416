"""Contract tests every Keychain must pass: the in-memory one tests use, and
macOS Keychain through the `security` CLI (opt in with APPLY_TEST_KEYCHAIN=1;
it uses a throwaway keychain file, never Lisul's login keychain)."""

import os
import subprocess

import pytest

from apply.keychain import InMemoryKeychain, MacKeychain


@pytest.fixture(params=["memory", "mac"])
def keychain(request, tmp_path):
    if request.param == "memory":
        yield InMemoryKeychain()
        return
    if not os.environ.get("APPLY_TEST_KEYCHAIN"):
        pytest.skip("set APPLY_TEST_KEYCHAIN=1 to use the real `security` CLI on a throwaway keychain")
    path = tmp_path / "apply-test.keychain-db"
    subprocess.run(["security", "create-keychain", "-p", "test", str(path)], check=True)
    try:
        subprocess.run(["security", "unlock-keychain", "-p", "test", str(path)], check=True)
        yield MacKeychain("apply-ats-test", keychain=path)
    finally:
        subprocess.run(["security", "delete-keychain", str(path)], check=False)


def test_a_site_with_no_password_has_none(keychain):
    assert keychain.password("acme.wd5.myworkdayjobs.com") is None


def test_a_saved_password_is_read_back_by_site(keychain):
    keychain.save("acme.wd5.myworkdayjobs.com", "Pa55-word!")
    keychain.save("other.wd1.myworkdayjobs.com", "Different#9")

    assert keychain.password("acme.wd5.myworkdayjobs.com") == "Pa55-word!"
    assert keychain.password("other.wd1.myworkdayjobs.com") == "Different#9"


def test_saving_again_replaces_the_password(keychain):
    keychain.save("acme.wd5.myworkdayjobs.com", "first-One1!")
    keychain.save("acme.wd5.myworkdayjobs.com", "second-Two2!")

    assert keychain.password("acme.wd5.myworkdayjobs.com") == "second-Two2!"


def test_a_forgotten_password_is_gone_and_others_stay(keychain):
    keychain.save("acme.wd5.myworkdayjobs.com", "Pa55-word!")
    keychain.save("other.wd1.myworkdayjobs.com", "Different#9")

    keychain.forget("acme.wd5.myworkdayjobs.com")
    keychain.forget("never.wd1.myworkdayjobs.com")  # no password there: nothing to remove

    assert keychain.password("acme.wd5.myworkdayjobs.com") is None
    assert keychain.password("other.wd1.myworkdayjobs.com") == "Different#9"


def test_passwords_with_shell_characters_survive(keychain):
    password = "a'b\"c $d `e` \\f;g|h&i"
    keychain.save("acme.wd5.myworkdayjobs.com", password)

    assert keychain.password("acme.wd5.myworkdayjobs.com") == password


def test_a_forgotten_password_is_gone_and_forgetting_none_is_fine(keychain):
    keychain.save("acme.wd5.myworkdayjobs.com", "Pa55-word!")
    keychain.save("other.wd1.myworkdayjobs.com", "Different#9")

    keychain.forget("acme.wd5.myworkdayjobs.com")
    keychain.forget("never.wd1.myworkdayjobs.com")

    assert keychain.password("acme.wd5.myworkdayjobs.com") is None
    assert keychain.password("other.wd1.myworkdayjobs.com") == "Different#9"


def test_sites_names_each_site_with_a_password_and_never_a_password(keychain):
    keychain.save("acme.wd5.myworkdayjobs.com", "Pa55-word!")
    keychain.save("other.wd1.myworkdayjobs.com", "Different#9")
    keychain.forget("other.wd1.myworkdayjobs.com")
    keychain.save("third.wd3.myworkdayjobs.com", "Third-3!x")

    assert sorted(keychain.sites()) == ["acme.wd5.myworkdayjobs.com", "third.wd3.myworkdayjobs.com"]


class FakeSecurity:
    """The `security` CLI, recording each call: its argv and what it got on stdin."""

    def __init__(self):
        self.calls, self.saved = [], {}

    def __call__(self, argv, input=None, **kw):
        self.calls.append((argv, input))
        if argv == ["security", "-i"]:
            # add-generic-password -U -s <service> -a "<site>" -w "<password>"
            site, password = (part.split('"')[1] for part in input.split(" -a ")[1].split(" -w "))
            self.saved[site] = password
            return subprocess.CompletedProcess(argv, 0, "", "")
        if argv[:2] == ["security", "find-generic-password"]:
            found = self.saved.get(argv[argv.index("-a") + 1])
            return subprocess.CompletedProcess(argv, 0 if found else 44, (found or "") + "\n", "")
        return subprocess.CompletedProcess(argv, 0, "", "")


def test_a_saved_password_never_goes_in_argv():
    # `ps` shows every process's argv while it runs: the password goes to `security -i` on stdin.
    password, security = "Fake-Pw-1!q", FakeSecurity()
    keychain = MacKeychain(run=security)

    keychain.save("acme.wd5.myworkdayjobs.com", password)

    assert keychain.password("acme.wd5.myworkdayjobs.com") == password
    assert not any(password in arg for argv, _ in security.calls for arg in argv)
    assert any(input and password in input for _, input in security.calls)


def test_a_line_break_never_reaches_securitys_command_line():
    with pytest.raises(ValueError):
        MacKeychain(run=FakeSecurity()).save("acme.wd5.myworkdayjobs.com", "one\ndelete-keychain")
