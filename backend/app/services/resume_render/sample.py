'''
The fixed resume the Tectonic proof renders (KAN-204): Jake's own sample
content, as data, written with the template's own commands. Every string goes
through escape(), as applicant text will once the bank feeds this (KAN-207).
'''

from app.services.resume_render import escape, jakes_document

NAME = "Jake Ryan"
PHONE = "123-456-7890"
LINKS = (
    ("mailto:x@x.com", "jake@su.edu"),
    ("https://linkedin.com/in/...", "linkedin.com/in/jake"),
    ("https://github.com/...", "github.com/jake"),
)
# (organization, location, title, start, end)
EDUCATION = (
    ("Southwestern University", "Georgetown, TX", "Bachelor of Arts in Computer Science, Minor in Business", "Aug. 2018", "May 2021"),
    ("Blinn College", "Bryan, TX", "Associate's in Liberal Arts", "Aug. 2014", "May 2018"),
)
# (title, start, end, organization, location, bullets)
EXPERIENCE = (
    ("Undergraduate Research Assistant", "June 2020", "Present", "Texas A&M University", "College Station, TX", (
        "Developed a REST API using FastAPI and PostgreSQL to store data from learning management systems",
        "Developed a full-stack web application using Flask, React, PostgreSQL and Docker to analyze GitHub data",
        "Explored ways to visualize GitHub collaboration in a classroom setting",
    )),
    ("Information Technology Support Specialist", "Sep. 2018", "Present", "Southwestern University", "Georgetown, TX", (
        "Communicate with managers to set up campus computers used on campus",
        "Assess and troubleshoot computer problems brought by students, faculty and staff",
        "Maintain upkeep of computers, classroom equipment, and 200 printers across campus",
    )),
    ("Artificial Intelligence Research Assistant", "May 2019", "July 2019", "Southwestern University", "Georgetown, TX", (
        "Explored methods to generate video game dungeons based off of The Legend of Zelda",
        "Developed a game in Java to test the generated dungeons",
        "Contributed 50K+ lines of code to an established codebase via Git",
        "Conducted a human subject study to determine which video game dungeon generation technique is enjoyable",
        "Wrote an 8-page paper and gave multiple presentations on-campus",
        "Presented virtually to the World Conference on Computational Intelligence",
    )),
)
# (name, technologies, start, end, bullets)
PROJECTS = (
    ("Gitlytics", "Python, Flask, React, PostgreSQL, Docker", "June 2020", "Present", (
        "Developed a full-stack web application using with Flask serving a REST API with React as the frontend",
        "Implemented GitHub OAuth to get data from user’s repositories",
        "Visualized GitHub data to show collaboration",
        "Used Celery and Redis for asynchronous tasks",
    )),
    ("Simple Paintball", "Spigot API, Java, Maven, TravisCI, Git", "May 2018", "May 2020", (
        "Developed a Minecraft server plugin to entertain kids during free time for a previous job",
        "Published plugin to websites gaining 2K+ downloads and an average 4.5/5-star review",
        "Implemented continuous delivery using TravisCI to build the plugin upon new a release",
        "Collaborated with Minecraft server administrators to suggest features and get feedback about the plugin",
    )),
)
SKILLS = (
    ("Languages", "Java, Python, C/C++, SQL (Postgres), JavaScript, HTML/CSS, R"),
    ("Frameworks", "React, Node.js, Flask, JUnit, WordPress, Material-UI, FastAPI"),
    ("Developer Tools", "Git, Docker, TravisCI, Google Cloud Platform, VS Code, Visual Studio, PyCharm, IntelliJ, Eclipse"),
    ("Libraries", "pandas, NumPy, Matplotlib"),
)


def _dates(start: str, end: str) -> str:
    return f"{escape(start)} -- {escape(end)}"


def _bullets(bullets: tuple[str, ...]) -> list[str]:
    # An empty itemize is a LaTeX error, so a list opens only around bullets
    if not bullets:
        return []
    return [r"\resumeItemListStart", *(rf"\resumeItem{{{escape(b)}}}" for b in bullets), r"\resumeItemListEnd"]


def body() -> str:
    '''The resume after \\begin{document}, as Jake's sample writes it.'''
    links = " $|$ ".join(rf"\href{{{escape(url)}}}{{\underline{{{escape(text)}}}}}" for url, text in LINKS)
    lines = [
        r"\begin{center}",
        rf"\textbf{{\Huge \scshape {escape(NAME)}}} \\ \vspace{{1pt}}",
        rf"\small {escape(PHONE)} $|$ {links}",
        r"\end{center}",
        r"\section{Education}",
        r"\resumeSubHeadingListStart",
    ]
    for org, location, title, start, end in EDUCATION:
        lines.append(rf"\resumeSubheading{{{escape(org)}}}{{{escape(location)}}}{{{escape(title)}}}{{{_dates(start, end)}}}")
    lines += [r"\resumeSubHeadingListEnd", r"\section{Experience}", r"\resumeSubHeadingListStart"]
    for title, start, end, org, location, bullets in EXPERIENCE:
        lines.append(rf"\resumeSubheading{{{escape(title)}}}{{{_dates(start, end)}}}{{{escape(org)}}}{{{escape(location)}}}")
        lines += _bullets(bullets)
    lines += [r"\resumeSubHeadingListEnd", r"\section{Projects}", r"\resumeSubHeadingListStart"]
    for name, tech, start, end, bullets in PROJECTS:
        lines.append(rf"\resumeProjectHeading{{\textbf{{{escape(name)}}} $|$ \emph{{{escape(tech)}}}}}{{{_dates(start, end)}}}")
        lines += _bullets(bullets)
    skills = r" \\ ".join(rf"\textbf{{{escape(label)}}}{{: {escape(items)}}}" for label, items in SKILLS)
    lines += [
        r"\resumeSubHeadingListEnd",
        r"\section{Technical Skills}",
        r"\begin{itemize}[leftmargin=0.15in, label={}]",
        rf"\small{{\item{{{skills}}}}}",
        r"\end{itemize}",
    ]
    return "\n".join(lines)


def document() -> str:
    return jakes_document(body())
