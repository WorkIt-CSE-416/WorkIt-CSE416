"""Captchas and bot blocks (apply.captcha): the words Apply tells them by."""

from apply import captcha


def test_a_bot_block_names_the_company_from_the_link_when_the_page_names_none():
    # Tesla (2026-11-03): its "Access Denied" page names no company.
    tesla = captcha.blocked("", "https://www.tesla.com/careers/search/job/287982", "You don't have permission to access")
    assert str(tesla) == ("Tesla blocked Apply's Chrome as a bot (\"You don't have permission to access\"). "
                          "Finish Tesla in your Chrome: the extension fills it")
    assert (tesla.company, tesla.url, tesla.bot_signal) == ("Tesla", "https://www.tesla.com/careers/search/job/287982",
                                                            "blocked")
    assert str(captcha.blocked("Lunar Outpost", "https://lunaroutpost.bamboohr.com/careers/398")).startswith(
        "Lunar Outpost blocked Apply's Chrome as a bot. ")


def test_access_denied_is_a_block_and_a_slider_is_a_captcha():
    tesla = 'The tab shows an "Access Denied" error from the server. No job posting is visible.'
    linkedin = ('a "Verification Required" slider challenge ("Slide right to secure your access") in an iframe. '
                "That is a captcha-style challenge, which I must not solve, so I stopped.")
    assert captcha.SAYS_BLOCKED.search(tesla) and not captcha.SAYS_CAPTCHA.search(tesla)
    assert captcha.SAYS_CAPTCHA.search(linkedin) and not captcha.SAYS_BLOCKED.search(linkedin)


def test_datadomes_block_is_a_block_though_claude_calls_it_a_captcha():
    # LinkedIn's SmartRecruiters form (2026-11-03): DataDome's block page, in the slider's own frame.
    why = ('DataDome\'s captcha frame says "We detected unusual activity from your device or network" '
           "and offers nothing to solve.")
    assert captcha.SAYS_BLOCKED.search(why)
