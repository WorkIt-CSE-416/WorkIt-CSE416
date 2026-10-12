# Categories, specialties and stage (KAN-172)

Which roles the shortlist keeps, how a title gets its categories and specialties, and the measurements behind each decision. Reached from `../CLAUDE.md`, "Filter changes need a real title".

## Twelve categories, their specialties, up to two a role (KAN-172)

The page kept software and AI roles until KAN-171, then the SimplifyJobs lists' five.
It now keeps twelve categories: `software`, `data_ai` (data science, AI and machine
learning), `hardware`, `quant` (quantitative research, trading and development),
`product` (product management), `engineering` (civil, mechanical, manufacturing,
aerospace and every other degree outside software and hardware), `business`
(operations, strategy, supply chain, program and project management), `finance`
(accounting, banking, investing, insurance), `marketing` (and communications), `sales`
(and business development), `hr` (and recruiting) and `design` (product, UX, UI and
visual design, UX research). Still early-career only and never senior. **Held off, so
dropped:** law and compliance, consulting, teaching, the arts, public policy and
customer support; a title naming none of the twelve ("Engineering Intern", "Research
Intern") is dropped too. `CATEGORY_TAGS` is their order on the page and in the app.

**`feed.json` carries a role's `roles`:** its categories, first first, then its
specialties (`["data_ai", "software", "data_ai/ml"]`; `Role.roles`). **Since KAN-155 the
backend ignores them:** it tags each job from its title with its own `job_roles` list
(`backend/app/services/role_resolver.py`), and dropped the `roles` and `role_category`
columns and `dto.role_key`. So a new key is a change to `Tag` alone. The categories still
decide what this scraper keeps, which is what they are for now.

**The first discipline the title names is its category** (`CATEGORIES`, first match
wins). The order is the decision:

1. **Job names first**, whatever they are about: a recruiter (`HR`), law (held),
   selling (`SALES`), a designer (`DESIGN`), program or project management and
   business analysis (`PROJECTS`, business). Jane Street's "Campus Recruiter, Machine
   Learning and Quantitative Research" recruits, "Sales Engineer Intern" sells, Waymo's
   "Quantitative UX Researcher" studies users, Astera Labs' "Hardware Technical Program
   Management Intern" manages a program.
2. **The technical disciplines, most specific first:** `QUANT` (a quant word names the
   job: "Quantitative Developer"), `PRODUCT`, data and AI (ML outranks what it runs on:
   IMC's "Hardware Machine Learning PhD Research Internship" is data), `EMBEDDED`
   (firmware and embedded are hardware, ahead of software), `SOFTWARE`'s own words,
   consulting (held; after software, so Latitude's "Entry Level Software Consultant"
   stays software), `SECURITY_IT` (software), `SUPPORT` (held; after IT, so a help desk
   is IT, and ahead of hardware: RF-SMART's "Hardware Support Internship"), `SUPPLY`
   (business; ahead of hardware: "Hardware Sourcing Intern"), `HARDWARE_JOB` (a
   "hardware engineer" by name), `ENGINEERING`, then the rest of `HARDWARE`.
   Engineering ranks ahead of hardware so Rivian's "Hardware Thermal Simulation
   Engineering Intern" is thermal work and an electrical engineer for buildings and
   utilities is a civil discipline (Burns & McDonnell's "Electrical Engineer-Power
   Systems", Olsson's "Electrical Engineering Internship - Facilities (Healthcare)"),
   and behind software so Valstad's "Software Engineering Intern, 3D & Manufacturing
   Applications" writes software.
3. **The business disciplines:** `PARTNERS` (partnerships and go-to-market, sales only
   when no other job is named: Agoda's "Salesforce Developer, Strategic Partnerships"
   develops), support roles and compliance (held), `FINANCE`, `MARKETING`, `BUSINESS`,
   then the held arts, policy and teaching.
4. **The modifiers, which only name a job nothing else does:** software's generic words
   ("web", "platform", a programming language), robotics (hardware), "AI" (data),
   "trading" (quant), engineering named by what it does ("Systems Engineer", "Test
   Engineering Intern"), and business's "operations", "strategy" and "analyst", never on
   an engineer's or a scientist's title (K2 Space's "Vehicle Operations Engineering
   Intern", Ginkgo's "Automation Scientist Intern, RAC Operations").

**A second category only for engineering jobs that are two at once** (`SECOND`): an
ML, AI or data engineer is data and software (Cresta's "Machine Learning Engineering
Intern", Figma's "Data Engineer Intern"), a firmware or embedded engineer hardware and
software (Graphcore's "Graduate Firmware Engineer"), a quant developer quant and
software. A research engineer researches, and a data scientist or an analyst analyses:
one category. Weak words never add one: "Software Engineer Intern (AI Internal Tools)" is
software only. Electrical plus mechanical was measured and left out: six titles, half
of them building or trade work.

**Specialties** (`SPECIALTIES`) are named in the title, within a category the role has;
a role can have several (Rocket Lab's "Propulsion Manufacturing Intern" is manufacturing
and aerospace) or none. Software has one, `software/security` (security and IT, a help
desk included: Jobright files help desks under support, but IT is the job most students
start in); data and AI four (`ml`, `data_science`, `analytics`, `data_engineering`);
engineering four (`civil`, `mechanical`, `manufacturing`, `aerospace`). Measured and left
plain `engineering`: power and building systems (about 40 job postings, BGE's
power-systems engineers, Olsson's substations) and chemical, materials and nuclear
(about 20).

**The stage** (`stage`). Two additions, each from real titles: a bank's or a fund's
"Summer Analyst" (both words: FT Partners' "2027 Equity Research Summer Analyst (US)",
UVIMCO's "Investment Analyst - Summer 2027"; five job postings, none a summer camp's) and
a working student ("Working Student", German "Werkstudent", "Student Worker": IMC,
Axon, Clera, Zoox; 28 job postings), both internships. And three guards the new
categories needed:

- **A manager or a lead is senior** unless the title says the person is junior or a
  student ("Junior Account Manager", "Sales Partner Manager Intern"): sales, marketing
  and operations careers start with those titles. The old rule dropped every manager but
  a product manager.
- **Who a role recruits is not its stage** (`AUDIENCE`): Stripe's "University
  Recruiter", Bridgewater's "Campus Talent Associate", Belvedere's "Early Career Talent
  Partner - Trading". A recruiter is kept only when the title says the person is junior
  or a student (`Stage.personal`): Path Robotics' "Early Career & University Relations
  Recruiter" is not. A year after it makes campus recruitment a program's name (Artefact's
  "Applied AI Engineer - China Campus Recruitment 2027").
- **Where a role is, is not its stage** (`PLACE`): Brooks's "Retail Sales Associate,
  University Village", SpaceX's "Bastrop Campus Planning Manager".

Decisions, each checked against the 2026-10-10 scan:

- **Firmware and embedded are hardware** (SimplifyJobs: 681 of 701), and their engineers
  software too. **Data engineers and data analysts are data**, not software (665 of 666,
  and 1,063 of 1,064). **Forward deployed engineers are software** (114 of 130). As in
  KAN-171.
- **Solutions engineers sell.** SimplifyJobs and Jobright split them; Astera Labs'
  "Platform Solutions Engineer Intern" moved from software to sales.
- **Product designers are design** and **"Trading Operations" is business**; both were
  dropped before.
- **A bare "Product Intern" is still dropped**, as is "Product Engineer": software at one
  company, consumer goods at the next.

**Measured** on a listings-only scan of every board on 2026-10-10 (101,100 job postings)
and the live `--full` run the same evening (101,098): kept job postings went from 1,723
to 3,507 (2,571 internships, 936 new-grad roles). By first category: software 957,
engineering 703, data_ai 413, hardware 287, business 227, finance 198, quant 187,
marketing 157, sales 156, hr 100, product 64, design 58; software in either category
1,144. Specialties: civil 269, ml 243, mechanical 160, security 122, manufacturing 101,
data science 75, analytics 68, aerospace 59, data engineering 43. Two categories: 187
(data and software 131, hardware and software 39, quant and software 17). Of the 1,723
the five kept, every change was read: 16 have another first category (MARGO's and three
Astera Labs titles to sales; three to data and AI, still software second; two each to
marketing, design, engineering and software; one to finance) and 4 are dropped (three
data-and-AI consultants at Celonis, and AlphaHire's research liaison, who recruits).
Against SimplifyJobs' labels on their own 21,458 titles, 86.4% of those we keep
in their five land in the same one, as before; 1,235 more are kept in the new
categories. Against Jobright's own lists (80,000 titles filed by field), of the titles
we keep: Account 84% finance, Business-Analyst 71% business, Design 88% design, HR 68%
hr (most of the rest are "Management Trainee" internships, business here), Management
94% business, Marketing 88% marketing, Sales 91% sales; most of their Consultant,
Legal, Art, Public Sector and Education titles are dropped. False positives found and
guarded, each now a test, among them Palantir's "Privacy and Civil Liberties Software
Engineer", DRW's "Software Developer Intern - Industrial Placement", TensorWave's
"Developer Community Engagement Intern" (marketing), WPP's "Junior Video Buyer" (media,
not purchasing), EQT's "Water Infrastructure Engineering Intern" (civil, not software)
and Belmond's hotel kitchens. **Known misses, accepted:** Jump Trading's and PDT
Partners' "Systems Engineer" are IT jobs read as engineering; an MEP firm's bare
"Electrical Engineer Summer Intern" reads as hardware; Welo Global's "AI Data Rater"
reads as data, as before.

**What it costs a run.** The first live `--full` run after the change, on a store from
earlier that day, took 412 seconds: 352 for the boards and the job postings' own pages
(Greenhouse read 1,088 more, about 110 seconds at its pacing, in its own lane while
Lever's one-second Crawl-delay was still going) and 48 for 242 newly listed boards'
logos. (Workable's 173 and BambooHR's 78 page reads were all of theirs: that store
predated both.) After that only the day's new job postings are read. The lasting cost is
quiet boards: a board with any kept job posting is read every run, and 97 more have one
(Lever 68 to 99, Greenhouse 233 to 316), which adds about 20 seconds of Lever's
Crawl-delay to a scheduled run. `feed.json` is 19 MB, from 9.

**Widening the net makes the newly kept roles "new today" once.** Only matching
postings are stored, so the first run after this change counts every newly kept role on
a board already read as new (the known limit under "New today" in `../CLAUDE.md`). Expect a day of
inflated "new" counts.
