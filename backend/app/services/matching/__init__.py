"""
Job matching: how well each listed job fits one applicant's resume.

    skills.py       the skill vocabulary, read out of postings and resumes
    roles.py        role families from titles and resumes, and how close two are
    eligibility.py  graduation against start date, and years of experience
    scoring.py      one score per job, the reasons behind it, and the ranking

Pure functions: no database, no HTTP. routers/recommendations.py loads the jobs
and the resume and hands them in. CLAUDE.md beside this file has the design,
its constants and what is still missing.
"""
