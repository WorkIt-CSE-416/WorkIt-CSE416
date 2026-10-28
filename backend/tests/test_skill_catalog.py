from app.services.skill_catalog import is_skill


def test_a_skill_written_with_a_slash_or_its_flavour_in_brackets_is_a_skill():
    assert is_skill("HTML/CSS")
    assert is_skill("SQL (Postgres)")
    assert is_skill("Spigot API")
    assert not is_skill("AI tools")
    assert not is_skill("Computer Science degree")
    assert not is_skill("Leadership (team of 5)")
