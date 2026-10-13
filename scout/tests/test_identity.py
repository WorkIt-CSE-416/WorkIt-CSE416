"""
Identity-data removal (KAN-205): the one function every model call's text
passes through. Run from backend/: `uv run pytest ../scout/tests`.
"""

from workit_scout.identity import remove_identity


def test_the_students_name_becomes_a_placeholder():
    text = "Jane Doe led a team of four. jane shipped it; Doe wrote the tests. Janet helped."
    assert remove_identity(text, name="Jane Doe") == (
        "[name] led a team of four. [name] shipped it; [name] wrote the tests. Janet helped."
    )


def test_the_profile_email_becomes_a_placeholder():
    text = "Reach me at Jane.Doe@StonyBrook.edu for details."
    assert remove_identity(text, email="jane.doe@stonybrook.edu") == (
        "Reach me at [email] for details."
    )


def test_any_email_becomes_a_placeholder_by_pattern():
    text = "Old address: jd_99+jobs@mail.example.co.uk, or ask hr@acme.io."
    assert remove_identity(text) == "Old address: [email], or ask [email]."


def test_the_profile_phone_becomes_a_placeholder_in_any_format():
    text = "Call 631.555.0142, (631) 555-0142 or +1 631 555 0142."
    assert remove_identity(text, phone="(631) 555-0142") == (
        "Call [phone], [phone] or [phone]."
    )


def test_any_phone_becomes_a_placeholder_by_pattern():
    text = "Cell: (212) 555-0199. Office +44 20 7946 0958."
    assert remove_identity(text) == "Cell: [phone]. Office [phone]."


def test_dates_and_numbers_in_bullets_are_not_phones():
    text = "Cut load time 40% for 12,000 users, 2021-2024; ID 20230615."
    assert remove_identity(text) == text
