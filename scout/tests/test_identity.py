"""
Identity-data removal (KAN-205): the one function every model call's text
passes through. Run from backend/: `uv run pytest ../scout/tests`.
"""

from workit_scout.identity import placeholders_in, remove_identity


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


def test_the_profile_links_become_placeholders():
    text = "See linkedin.com/in/janedoe and my site janedoe.dev for more."
    links = ["https://www.linkedin.com/in/janedoe/", "https://janedoe.dev"]
    assert remove_identity(text, links=links) == (
        "See [link] and my site [link] for more."
    )


def test_any_url_becomes_a_placeholder_by_pattern():
    text = "Demo: https://demo.example.com/app?x=1. Code at github.com/jd/repo, or www.jd.io!"
    assert remove_identity(text) == "Demo: [link]. Code at [link], or [link]!"


def test_tool_names_with_dots_are_not_links():
    text = "Built with Node.js, ASP.NET and Next.js; 3.5 GPA."
    assert remove_identity(text) == text


def test_numbers_with_a_slash_are_not_links():
    # "3.81/4.00" once matched the bare-host pattern and the GPA reached
    # the model as [link]
    text = "GPA: 3.81/4.00, ran 1.5/2 days, version 2.0/beta."
    assert remove_identity(text) == text


def test_text_with_no_identity_data_is_unchanged():
    text = (
        "Software Engineer Intern, Acme Corp, New York, NY, May 2024 - Aug 2024.\n"
        "- Cut p95 latency 35% by caching 1.2M requests/day in Redis (v7.2)."
    )
    profile = {
        "name": "Jane Doe",
        "email": "jane@doe.dev",
        "phone": "631-555-0142",
        "links": ["https://github.com/janedoe", None],
    }
    assert remove_identity(text, **profile) == text


def test_every_kind_together_with_the_name_inside_a_link():
    text = (
        "Jane Doe | jane.doe@gmail.com | 631-555-0142 | github.com/janedoe\n"
        "Contact Jane at https://janedoe.dev/contact."
    )
    out = remove_identity(
        text,
        name="Jane Doe",
        email="jane.doe@gmail.com",
        phone="6315550142",
        links=["github.com/janedoe", "janedoe.dev"],
    )
    assert out == "[name] | [email] | [phone] | [link]\nContact [name] at [link]."


def test_placeholders_in_names_each_placeholder_the_text_holds():
    assert placeholders_in("Built [link] for [name], then [name] again") == ["[name]", "[link]"]
    assert placeholders_in("Built a link checker for names") == []
