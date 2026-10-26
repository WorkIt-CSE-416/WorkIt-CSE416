"""answers_from_bank: the stored bank read back as the API's shape, with no
database (schemas/autofill_answers.py)."""

from app.schemas.autofill_answers import answers_from_bank


def test_an_option_no_longer_offered_reads_as_unanswered():
    bank = {
        "needs_sponsorship": "no",
        "security_clearance": "q_clearance",
        "a_key_from_a_later_version": "x",
    }
    answers = answers_from_bank(bank)
    assert answers.needs_sponsorship == "no"
    assert answers.security_clearance is None


def test_an_entry_of_the_wrong_shape_reads_as_unanswered():
    # Only the PATCH route writes the bank today, always as plain answers; a
    # script, the extension or a hand fix could store a list or an object.
    bank = {
        "gender": "male",
        "veteran_status": ["declined"],
        "disability_status": {"answer": "yes"},
    }
    answers = answers_from_bank(bank)
    assert answers.gender == "male"
    assert answers.veteran_status is None
    assert answers.disability_status is None


def test_application_answers_read_back_and_a_wrong_shape_reads_as_unanswered():
    # The Application answers (made-up values): dates, terms, lists and the
    # screener facts, where an empty list is the student's own "none".
    bank = {
        "onsite_ok": "yes",
        "earliest_start": "2027-05-24",
        "latest_end": "27 Aug",
        "available_terms": ["summer 2027"],
        "location_preferences": ["Springfield, IL"],
        "address_line1": "1 Example Way",
        "postal_code": "00000",
        "languages": ["English", "Spanish"],
        "relatives_at": [],
        "pending_offers": "none",
        "non_compete": "no",
    }
    answers = answers_from_bank(bank)
    assert answers.onsite_ok == "yes"
    assert answers.earliest_start == "2027-05-24"
    assert answers.latest_end is None
    assert answers.available_terms == ["summer 2027"]
    assert answers.languages == ["English", "Spanish"]
    assert answers.relatives_at == []
    assert answers.pending_offers is None
    assert answers.non_compete == "no"
    assert answers.referred_at is None


def test_more_application_answers_read_back_each_by_its_own_shape():
    # Never served, age, pay, the EEO extras, role interests and an X link
    # (made-up values); a value of another shape reads as unanswered.
    bank = {
        "veteran_status": "not_veteran",
        "age_18_or_over": "yes",
        "expected_hourly_pay": 32.5,
        "accept_posted_pay": "no",
        "sexual_orientation": "declined",
        "transgender": "no",
        "pronouns": "they_them",
        "communities": [],
        "role_interests": ["backend", "embedded"],
        "x_url": "https://x.com/example",
        "expected_hourly_pay_typo": 1,
    }
    answers = answers_from_bank(bank)
    assert answers.veteran_status == "not_veteran"
    assert answers.age_18_or_over == "yes"
    assert answers.expected_hourly_pay == 32.5
    assert answers.accept_posted_pay == "no"
    assert answers.sexual_orientation == "declined"
    assert answers.transgender == "no"
    assert answers.pronouns == "they_them"
    assert answers.communities == []
    assert answers.role_interests == ["backend", "embedded"]
    assert answers.x_url == "https://x.com/example"
    assert answers_from_bank({"expected_hourly_pay": "30", "role_interests": ["cooking"]}).expected_hourly_pay is None
    assert answers_from_bank({"role_interests": ["cooking"]}).role_interests is None


def test_countries_of_citizenship_read_back_as_a_list():
    assert answers_from_bank({"citizenship_countries": ["India"]}).citizenship_countries == ["India"]
    assert answers_from_bank({"citizenship_countries": "India"}).citizenship_countries is None
