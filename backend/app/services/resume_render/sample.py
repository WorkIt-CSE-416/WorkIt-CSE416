'''
A fixed built resume view: Jake's own sample content as bank data (KAN-204,
KAN-207). scripts/fetch_tectonic.py renders it to warm Tectonic's cache, so
the warm-up goes through the same template code as a real resume and fetches
every font shape that code uses; the template text test renders it too.
'''

import datetime
import itertools
import uuid
from decimal import Decimal

from app.services.resume_render import HeaderIdentity, jakes_document
from app.services.resume_view import (
    ResumeView,
    ViewBullet,
    ViewEntry,
    ViewSection,
    ViewSkill,
)

_ids = (uuid.UUID(int=n) for n in itertools.count(1))


def _month(year: int, month: int) -> datetime.date:
    return datetime.date(year, month, 1)


def _bullets(*texts: str) -> tuple[ViewBullet, ...]:
    return tuple(ViewBullet(next(_ids), t) for t in texts)


IDENTITY = HeaderIdentity(
    name="Jake Ryan",
    email="jake@su.edu",
    phone="123-456-7890",
    links=("https://linkedin.com/in/jake", "https://github.com/jake"),
)

VIEW = ResumeView(
    sections=(
        ViewSection("education", (
            ViewEntry(next(_ids), "education", "Southwestern University", location="Georgetown, TX",
                      degree="Bachelor of Arts", field_of_study="Computer Science, Minor in Business",
                      gpa=Decimal("3.80"), gpa_scale=Decimal("4.00"),
                      start_month=_month(2018, 8), end_month=_month(2021, 5), end_kind="month"),
            ViewEntry(next(_ids), "education", "Blinn College", location="Bryan, TX",
                      degree="Associate's in Liberal Arts",
                      start_month=_month(2014, 8), end_month=_month(2018, 5), end_kind="month"),
        )),
        ViewSection("experience", (
            ViewEntry(next(_ids), "experience", "Undergraduate Research Assistant",
                      organization="Texas A&M University", location="College Station, TX",
                      start_month=_month(2020, 6), end_kind="present", bullets=_bullets(
                          "Developed a REST API using FastAPI and PostgreSQL to store data from learning management systems",
                          "Developed a full-stack web application using Flask, React, PostgreSQL and Docker to analyze GitHub data",
                          "Explored ways to visualize GitHub collaboration in a classroom setting",
                      )),
            ViewEntry(next(_ids), "experience", "Information Technology Support Specialist",
                      organization="Southwestern University", location="Georgetown, TX",
                      start_month=_month(2018, 9), end_kind="present", bullets=_bullets(
                          "Communicate with managers to set up campus computers used on campus",
                          "Assess and troubleshoot computer problems brought by students, faculty and staff",
                          "Maintain upkeep of computers, classroom equipment, and 200 printers across campus",
                      )),
            ViewEntry(next(_ids), "experience", "Artificial Intelligence Research Assistant",
                      organization="Southwestern University", location="Georgetown, TX",
                      start_month=_month(2019, 5), end_month=_month(2019, 7), end_kind="month", bullets=_bullets(
                          "Explored methods to generate video game dungeons based off of The Legend of Zelda",
                          "Developed a game in Java to test the generated dungeons",
                          "Contributed 50K+ lines of code to an established codebase via Git",
                          "Conducted a human subject study to determine which video game dungeon generation technique is enjoyable",
                          "Wrote an 8-page paper and gave multiple presentations on-campus",
                          "Presented virtually to the World Conference on Computational Intelligence",
                      )),
        )),
        ViewSection("projects", (
            # The bank has no technologies field; the organization slot
            # carries Jake's list here, as a team or course would
            ViewEntry(next(_ids), "projects", "Gitlytics", organization="Python, Flask, React, PostgreSQL, Docker",
                      start_month=_month(2020, 6), end_kind="present", bullets=_bullets(
                          "Developed a full-stack web application using with Flask serving a REST API with React as the frontend",
                          "Implemented GitHub OAuth to get data from user’s repositories",
                          "Visualized GitHub data to show collaboration",
                          "Used Celery and Redis for asynchronous tasks",
                      )),
            ViewEntry(next(_ids), "projects", "Simple Paintball",
                      organization="Spigot API, Java, Maven, TravisCI, Git",
                      start_month=_month(2018, 5), end_month=_month(2020, 5), end_kind="month", bullets=_bullets(
                          "Developed a Minecraft server plugin to entertain kids during free time for a previous job",
                          "Published plugin to websites gaining 2K+ downloads and an average 4.5/5-star review",
                          "Implemented continuous delivery using TravisCI to build the plugin upon new a release",
                          "Collaborated with Minecraft server administrators to suggest features and get feedback about the plugin",
                      )),
        )),
    ),
    skills=tuple(
        ViewSkill(next(_ids), name, group)
        for group, names in (
            ("Languages", ("Java", "Python", "C/C++", "SQL (Postgres)", "JavaScript", "HTML/CSS", "R")),
            ("Frameworks", ("React", "Node.js", "Flask", "JUnit", "WordPress", "Material-UI", "FastAPI")),
            ("Developer Tools", ("Git", "Docker", "TravisCI", "Google Cloud Platform", "VS Code",
                                 "Visual Studio", "PyCharm", "IntelliJ", "Eclipse")),
            ("Libraries", ("pandas", "NumPy", "Matplotlib")),
        )
        for name in names
    ),
)


def document() -> str:
    from app.services.resume_render import jakes

    return jakes_document(jakes.body(VIEW, IDENTITY))


SIZES = ("tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge")
SHAPES = ("upshape", "itshape", "scshape", "slshape")


def fonts() -> str:
    '''Jake's preamble with a word in every size, shape and weight, so the
    warm-up caches every Latin Modern file a page can reach. The sample
    alone missed one (KAN-218): `\\large` upright, which a section heading
    selects only at some page breaks, failed offline once Fit to One Page
    moved "Technical Skills" across one.'''
    words = [f"{{\\{size}\\{shape}\\{weight} Aa}}" for size in SIZES for shape in SHAPES
             for weight in ("mdseries", "bfseries")]
    return jakes_document(" ".join(words))
