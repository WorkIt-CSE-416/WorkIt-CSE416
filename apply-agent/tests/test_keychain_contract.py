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


def test_passwords_with_shell_characters_survive(keychain):
    password = "a'b\"c $d `e` \\f;g|h&i"
    keychain.save("acme.wd5.myworkdayjobs.com", password)

    assert keychain.password("acme.wd5.myworkdayjobs.com") == password
