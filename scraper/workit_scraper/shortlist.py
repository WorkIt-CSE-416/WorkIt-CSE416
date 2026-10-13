"""Decide which postings belong on the page, and collapse true duplicates.

The scraper's densest logic, and the place a bug is quietest. Two steps:

1. **Classify.** A posting is kept when its title names an early-career stage
   (`intern` or `new-grad`, `stage`) *and* one of twelve categories (KAN-172,
   `CATEGORIES`), and the first discipline it names is not one we hold off on
   (law, consulting, teaching, the arts, policy, customer support). The first
   discipline is the role's category; a few engineering titles name a second
   (`SECOND`), and some categories have specialties (`SPECIALTIES`).

2. **Dedupe** on `apply_url`. Each URL is its own job: Stripe posting "Software
   Engineer, New Grad" once per office, each with its own application, is seven
   jobs and seven rows. Only copies sharing one URL -- the same application
   reached from several places -- collapse into one role carrying their locations.
   Keying on `(company, title)` instead merged those seven and kept one link,
   hiding six applications. The one exception is Workday's: one requisition
   posted on two of a company's careers sites is one job with two URLs, so it is
   one role, linking the site built for students (`_requisition`, `_lead`).

Deduping is presentation only: every posting that classifies is stored in jobs.json
as its own row. (Postings that do not classify are counted and never stored.)
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from enum import StrEnum

from workit_scraper.details import Facts
from workit_scraper.providers import Job


class Tag(StrEnum):
    """What a role is: a stage, then one or two categories, then any specialties.

    The category and specialty values are `feed.json`'s `roles`, which the backend
    ignores since KAN-155 (it tags jobs with its own job_roles list), so a new one
    is a change here alone."""

    INTERN = "intern"
    NEW_GRAD = "new-grad"

    SOFTWARE = "software"
    DATA_AI = "data_ai"
    HARDWARE = "hardware"
    QUANT = "quant"
    PRODUCT = "product"
    #: Every engineering degree outside software and hardware: civil, mechanical,
    #: manufacturing, aerospace, chemical, nuclear and the rest.
    ENGINEERING = "engineering"
    BUSINESS = "business"
    FINANCE = "finance"
    MARKETING = "marketing"
    SALES = "sales"
    HR = "hr"
    DESIGN = "design"

    SECURITY_IT = "software/security"
    ML = "data_ai/ml"
    DATA_SCIENCE = "data_ai/data_science"
    ANALYTICS = "data_ai/analytics"
    DATA_ENGINEERING = "data_ai/data_engineering"
    CIVIL = "engineering/civil"
    MECHANICAL = "engineering/mechanical"
    MANUFACTURING = "engineering/manufacturing"
    AEROSPACE = "engineering/aerospace"


#: A role's categories, in the order the page and the app list them.
CATEGORY_TAGS = (
    Tag.SOFTWARE,
    Tag.DATA_AI,
    Tag.HARDWARE,
    Tag.QUANT,
    Tag.PRODUCT,
    Tag.ENGINEERING,
    Tag.BUSINESS,
    Tag.FINANCE,
    Tag.MARKETING,
    Tag.SALES,
    Tag.HR,
    Tag.DESIGN,
)


def rx(*parts: str) -> re.Pattern[str]:
    """One case-insensitive pattern from alternatives, one per line where it is used."""
    return re.compile("|".join(parts), re.I)


# --- The stage -----------------------------------------------------------------

INTERN = rx(
    r"\bintern(?:s|ship|ships)?\b",
    r"\bco-?op\b",
    # A student working part-time through a degree, Germany's Werkstudent: IMC's
    # "Working Student - Tech", Axon's "DSP Engineer - Werkstudent", Zoox's
    # "Contract Student Worker - Data Scientist".
    r"\bworking students?\b",
    r"\bwerkstudent\w*",
    r"\bstudent workers?\b",
)
# A bank's or a fund's summer internship is a "Summer Analyst": FT Partners' "2027
# Equity Research Summer Analyst (US)", Arena Investors' "London Summer Investment
# Analyst", UVIMCO's "Investment Analyst - Summer 2027". Both words, so neither a
# year-round analyst nor JCC's "Summer Day Camp" counselors count.
SUMMER_ANALYST = re.compile(r"^(?=.*\bsummer\b)(?=.*\banalysts?\b)", re.I)
NEW_GRAD = rx(
    r"\bnew ?grad(?:uate)?\b",
    r"\bgraduate\b",
    r"\bentry[- ]level\b",
    r"\bjunior\b",
    r"\bapprentice\b",
)
# These say a role is for students or graduates as often as they say who a
# recruiter recruits ("University Recruiter") or where a job is (below).
PROGRAM = rx(r"\buniversity\b", r"\bcampus\b", r"\bearly[- ]career\b")
# Who a role recruits or serves, not who fills it: Stripe's "University Recruiter",
# Jane Street's "Campus Recruiter, Machine Learning and Quantitative Research",
# Belvedere's "Early Career Talent Partner - Trading", Bridgewater's "Campus Talent
# Associate", Chicago Trading Company's "Campus Relations & Events Associate". These
# words are not a stage; they were vetoed whole until recruiting became a category.
# A year after it makes it a program's name: Artefact's "Applied AI Engineer - China
# Campus Recruitment 2027" is a graduate's job.
AUDIENCE = re.compile(
    r"\b(?:university|campus|early[- ]careers?|early talent)(?:\s*&\s*\w+)?\s+(?:recruit\w*"
    r"(?!\s+20\d\d)|relations|talent|engagement|outreach|partnerships?|ambassadors?|events?"
    r"|hiring|lead|programs?\s+(?:manager|lead|coordinator|specialist|partner))\b"
    # Canonical's "Graduate Talent Scientist" is a graduate; its "Talent Scientist -
    # Graduate Lead" leads the graduates.
    r"|\b(?:graduate|intern(?:ship)?s?|student)\s+(?:recruit\w*|relations|outreach|hiring|lead"
    r"|ambassadors?|programs?\s+(?:manager|lead|coordinator|specialist|partner))\b",
    re.I,
)
# A place, not a stage: Brooks's "Retail Sales Associate, University Village",
# Daniels Health's "Vanderbilt University Medical Center", SpaceX's "Bastrop Campus
# Planning Manager", Think Academy's "English Teacher – Beijing Campus". Capitals
# matter: a name before the word is what makes it a place, unless it recruits
# there (Artefact's "China Campus Recruitment 2027").
PLACE = re.compile(
    r"(?i:\b(?:university|campus)\s+(?:of|village|medical|hospital|health|construction"
    r"|planning|infrastructure)\b)|\b[A-Z][\w.&'-]*\s+(?:University|Campus)\b(?!\s+(?i:recruit))",
)
# A genuinely early-career posting never advertises a senior level. Together AI lists
# "Junior/Senior or Staff Software Engineer, Inference" -- one opening at any level,
# which matches `junior` and is not a new-grad role. Seniority wins over the stage.
SENIOR = rx(
    r"\bsenior\b",
    r"\bstaff\b",
    r"\bprincipal\b",
    r"\bdirector\b",
    r"\bhead of\b",
    r"\bvp\b",
    r"\bvice president\b",
)
# A manager or a lead is senior too, unless the title says the person is junior or
# still in school: Smartsheet's "Junior Account Manager", Canonical's "Junior Project
# Manager" and Aircall's "Sales Partner Manager Intern" are where sales and
# operations careers start; FluidStack's "Early Careers Lead/Program Manager" and
# SpaceX's "Campus Infrastructure Project Manager" are not. A product manager is the
# job's name.
LEADS = rx(r"(?<!product )\bmanagers?\b", r"\blead\b(?! gen)")


@dataclass(frozen=True, slots=True)
class Stage:
    tag: Tag
    #: The title says who fills the role ("Intern", "Junior", "New Grad"), not
    #: only the program it belongs to ("University", "Campus", "Early Career").
    personal: bool


def stage(title: str) -> Stage | None:
    """The role's stage, or None when the title names no early-career one."""
    if not title or SENIOR.search(title):
        return None
    words = PLACE.sub(" ", AUDIENCE.sub(" ", title))
    intern = bool(INTERN.search(words) or SUMMER_ANALYST.search(words))
    personal = intern or bool(NEW_GRAD.search(words))
    if LEADS.search(words) and not personal:
        return None
    if intern:
        return Stage(Tag.INTERN, personal=True)
    if personal or PROGRAM.search(words):
        return Stage(Tag.NEW_GRAD, personal)
    return None


# --- The categories ---------------------------------------------------------------
#
# "Engineer" on its own is not a signal. Wade Trim posts "Engineer Summer Intern",
# a civil firm; nothing in a bare "Engineering Intern" tells a software company's
# from theirs, so each category names its specialisms instead and such a title is
# dropped.

# Recruiting and HR, named as the job. It outranks every discipline the title
# recruits for, so Jane Street's ML recruiter is a recruiter; as a team or a
# subject ("People Team: Software Engineer Intern", Coinbase's "Forward Deployed
# Engineer Intern (HR Technology)", VAST's "Emerging Talent - Electrical
# Engineering Internship") it is not, and nor is campus recruiting, the way
# XPENG hires ("2027 Campus Recruiting Robotics Center Internship Position").
HR = rx(
    r"(?<!campus )\brecruit(?:er|ers|ing|ment)\b",
    r"\btalent (?:acquisition|partner|management|coordinator|operations|scientist|sourc\w*)",
    r"\bsourcers?\b",
    r"\bhuman resources?\b",
    r"\bhr\b(?!\s+(?:tech\w*|systems?|data|analytics|software|platform))",
    r"\bhrbp\b",
    r"\bpeople (?:operations|ops|partner|center|&\s*culture|and culture)\b",
    r"\btotal rewards\b",
    r"\bcompensation (?:and|&) benefits\b",
    r"\blearning (?:and|&) development\b",
)
# Law, as the job; compliance is held off below, after security.
LEGAL = rx(
    r"\blegal\b",
    r"\bparalegal",
    r"\battorneys?\b",
    r"\blawyers?\b",
    r"\bcounsel\b",
    r"\blaw (?:clerk|intern|student)",
)
# Selling, as the job: "Sales Engineer Intern" and "Software Sales" are sales.
# Salesforce is a product (`\bsales\b` stops short of it); a "business developer"
# is French for a sales rep (MARGO's "Business Developer Junior - CDI").
SALES = rx(
    r"\bsales\b",
    r"\baccount executives?\b",
    r"\baccount manag\w*",
    r"\bkey accounts?\b",
    r"\bbusiness develop(?:ment|er)\b",
    r"\b[bs]dr\b",
    r"\b(?:sales|account) development\b",
    r"\bpre-?sales\b",
    r"\bsolutions? (?:engineer\w*|consultant)",
    # Selling insurance or financial products: "Entry Level Insurance Agent",
    # "Financial Representative - Entry Level" (Jobright's sales list).
    r"\b(?:insurance|financial|finance) (?:agents?|representatives?|brokers?)\b",
)
# Partnerships and go-to-market name a sales team, so only a title naming no other
# job: Agoda's "Junior Application Specialist - Salesforce Developer, Strategic
# Partnerships" develops software. One partnership is a program: Bluestaq's
# Graduate Research Scholar comes of its "NDSU Partnership".
PARTNERS = rx(
    r"\bpartnerships\b",
    r"\bpartnership (?:intern\w*|associate|manager|team|specialist|development)\b",
    r"\bgo[- ]to[- ]market\b",
    r"\bgtm\b",
)
# Consulting, held off: Veeva's "Associate Consultant - Entry-Level Technology
# Consulting", CRA's "Accounting/Business/Finance Consulting Analyst". A solutions
# consultant sells (above) and a recruitment consultant recruits; a consultant who
# names data or software keeps that job (Fifty-Five's "Data Analyst Consultant
# Intern", Latitude's "Entry Level Software Consultant").
CONSULTING = rx(r"\bconsult(?:ant|ants|ing)\b", r"\bmanagement advisory\b")
# Designers who design products, screens and brands. A designer of circuits, parts
# or buildings is an engineer or a drafter (Nexus's "Electrical Drafter/Designer",
# E-Space's "Junior Mechanical Designer"), and a product design *engineer* designs
# hardware (SharkNinja, Skydio).
_DESIGNER = (
    r"(?<!electrical )(?<!mechanical )(?<!civil )(?<!structural )(?<!hardware )"
    r"(?<!circuit )(?<!asic )(?<!fpga )(?<!pcb )(?<!cad )(?<!piping )(?<!lighting )"
    r"(?<!digital )(?<!analog )(?<!physical )(?<!chip )(?<!rf )(?<!ic )(?<!process )"
    r"(?<!architect )(?<!technical )\bdesigners?\b"
)
DESIGN = rx(
    _DESIGNER,
    r"\bproduct design\b(?!\s+(?:engineer\w*|mechanical))",
    r"\b(?:visual|graphic|brand|motion|interaction|experience|communication|web|industrial"
    r"|ui|ux) design\w*",
    r"\bux\b(?!\s*(?:/\s*ui\s+)?(?:test\s+)?engineer)",
    r"\buser (?:experience|research\w*)\b",
    r"\bdesign (?:research\w*|technologist)\b",
    r"^\W*design\b(?!\s+(?:verification|engineer\w*|architect\w*|automation))",
)
# Program and project management and business analysis are business jobs
# whatever they are about: the old list vetoed Astera Labs' "Hardware Technical
# Program Management Intern", and EQ Bank's "Intern, Business Analyst (PC
# Insurance)" analyses the business, not the policies.
PROJECTS = rx(
    r"\b(?:program|project) manag\w*",
    r"\b(?:program|project) coordinat\w*",
    r"\bbusiness analy\w*",
)

# A quant word names the role whatever else the title says: "Quantitative
# Developer" is a quant's job, not a software one, and so is a trading desk's
# analyst or intern (Garda's "Trading Analyst Intern, Credit"). Not Waymo's
# "Quantitative UX Researcher", who studies users (DESIGN, above).
QUANT = rx(
    r"\bquant(?:s|itative)?\b",
    r"\btraders?\b",
    r"\btrading (?:analyst|intern\w*|associate|assistant)\b",
)
# "Trading" alone is weaker. "Software Engineer, Trading Systems" is a software
# job at a trading firm, so it is quant only when nothing else claims the title;
# "Trading Operations" is back office (BUSINESS).
TRADING = rx(r"\btrading\b(?!\s+operations?\b)")
PRODUCT = rx(
    r"\bproduct manag\w*",
    r"\bproduct owner\b",
    r"\bproduct analyst\b",
    r"\bproduct (?:operations|ops|strategy)\b",
    r"\bapm\b",
)
# Machine learning and AI: a strong word names the job outright.
ML = rx(
    r"\bmachine learning\b",
    r"\bml\b",
    r"\bdeep learning\b",
    r"\bnlp\b",
    r"\bcomputer vision\b",
    # A robot's or a car's perception, not Brooks's "Run Perception Graduate
    # Internship" (consumer research).
    r"(?<!run )\bperception\b",
    r"\breinforcement learning\b",
    r"\brobot learning\b",
    r"\bartificial intelligence\b",
    r"\bresearch (?:scientist|engineer)\b",
    r"\bapplied (?:ai|scien\w*|research\w*)\b",
    # An AI engineer's job is AI, though "AI" alone only modifies: EQ Bank's
    # "Intern - Commercial Lending AI Engineer" builds models, not loans.
    r"\b(?:ai|a\.i\.|gen-?ai|generative ai|llm)\s+(?:software\s+)?engineer\w*",
)
DATA_SCIENCE = rx(r"\bdata scien\w*", r"\bstatistic\w*")
DATA_ENGINEERING = rx(
    r"\bdata engineer\w*",
    r"\banalytics engineer\w*",
    r"\bdata platforms?\b",
    r"\betl\b",
    r"\bdata pipelines?\b",
)
ANALYTICS = rx(
    r"\bdata analy\w*",
    r"\banalytics\b(?!\s+engineer)",
    r"\bbusiness intelligence\b",
    r"\bbi\b",
    r"\bdata visuali[sz]ation\b",
    r"\btableau\b",
    r"\bpower bi\b",
)
# "AI" as a modifier is weaker: "Software Engineer Intern (AI Internal Tools)" is a
# software job, as SimplifyJobs files 281 of its 347 titles naming both. So it
# claims a title only after hardware and software have passed.
AI = rx(
    r"\bai\b",
    r"\ba\.i\.",
    r"\bgen-?ai\b",
    r"\bgenerative ai\b",
    r"\bllms?\b",
    r"\bagentic\b",
)
# Firmware and embedded are hardware, "Embedded Software Engineer" included:
# SimplifyJobs files 681 of 701 under Hardware. They rank ahead of software's own
# words, the rest of hardware after them (HARDWARE).
EMBEDDED = rx(r"\bembedded\b", r"\bfirmware\b")
# Software's own words. Ahead of the engineering disciplines, so Valstad's
# "Software Engineering Intern, 3D & Manufacturing Applications" and Muon Space's
# "GNC Software Engineering Intern" stay software. "Software-defined radio" is
# Astranis's RF hardware; a developer of business, community or relations is not
# a programmer.
SOFTWARE = rx(
    r"\bsoftware\b(?![- ]defined)",
    r"(?<!business )\bdeveloper\b(?!\s+(?:relations|advocate|community|marketing))",
    r"\bprogrammers?\b",
    r"\bprogramming\b",
    r"\bswe\b",
    r"\bback[- ]?end\b",
    r"\bfront[- ]?end\b",
    r"\bfull[- ]?stack\b",
    r"\bios\b",
    r"\bandroid\b",
    r"\bdistributed systems\b",
    r"\bsystems? software\b",
    r"\bdev\s?(?:sec)?ops\b",
    r"\bsre\b",
    r"\bsite reliability\b",
    r"\bcompilers?\b",
    r"\bkernel\b",
    r"\bsecurity engineer\w*",
    r"\bnetwork engineer\w*",
    r"\bcomputer science\b",
    r"\bcoding\b",
    r"\bgraphics engineer\w*",
    r"\bbuild (?:&|and) release\b",
    r"\bcloud operations\b",
    # SimplifyJobs files 114 of its 130 forward deployed roles under Software.
    r"\bforward deployed\b",
)
# Software's generic words, which only name it when nothing above does: "Web
# Content Intern" and "Cloud Sales Intern" are not software jobs, and The
# Exploration Company's "Radiation Testing of Electronic Components and Test
# Automation" is hardware. A programming language names a programmer
# (TELUS's "React Native Intern"; Captivation's "Junior Systems Engineer (Hybrid)
# - Jira/Confluence/Agile/Java/JavaScript").
SOFTWARE_WEAK = rx(
    r"\bweb\b",
    r"\bmobile\b",
    r"\binfrastructure\b",
    r"\bplatform\b",
    r"\bcloud\b",
    r"\bdatabase\b",
    r"\bapi\b",
    r"\bqa\b",
    r"\bquality assurance\b",
    r"\btest automation\b",
    r"\b(?:systems|integration) reliability\b",
    r"\bjava(?:script)?\b",
    r"\btypescript\b",
    r"\bpython\b",
    r"\bc\+\+",
    r"\bc#",
    r"\bgolang\b",
    r"\breact\b",
    r"\bangular\b",
    r"\.net\b",
)
# Supply chain, sourcing and logistics are business jobs, ahead of the hardware
# and engineering they buy for (the old list vetoed "Hardware Sourcing Intern"),
# but behind software: Healf's "Software Engineer (Supply Chain)" writes software.
# A media buyer buys advertising (MARKETING).
SUPPLY = rx(
    r"\bsupply chain\b",
    r"\bsourcing\b",
    r"\bprocurement\b",
    r"\bpurchasing\b",
    r"\blogistics\b",
    r"(?<!media )(?<!video )\bbuyers?\b",
    r"\bvendor management\b",
    r"\binventory\b",
    r"\bsupply planner\b",
)
# Engineering degrees outside software and hardware: SimplifyJobs' Hardware list
# holds 641 "electrical" titles against 74 "mechanical". Ahead of hardware, so
# "Hardware Thermal Simulation Engineering Intern" (Rivian) is thermal work and an
# electrical engineer for buildings and utilities is a civil discipline (Burns &
# McDonnell's "Electrical Engineer-Power Systems", Olsson's "Electrical Engineering
# Internship - Facilities (Healthcare)", EQT's "Midstream Electrical Engineer").
CIVIL = rx(
    r"\bcivil\b(?!\s+(?:liberties|rights))",
    r"\bstructural\b(?!\s+analysis)",
    r"\bconstruction\b",
    r"\bgeotechnical\b",
    r"\btransportation\b",
    r"\broadway\b",
    r"\btraffic\b",
    r"\brail\b",
    r"\bbridges?\b",
    r"\bland(?:/site)? development\b",
    r"\bsite (?:civil|design|development)\b",
    r"\bsurvey(?:ing|or|ors)?\b(?!.*\btechnician)",
    r"\bpublic works\b",
    r"\bwater resources?\b",
    r"\bwater infrastructure\b",
    r"\b(?:waste|storm)water\b",
    r"\bwater/wastewater\b",
    r"\bcoastal\b",
    r"\bwaterfront\b",
    r"\benvironmental engineer\w*",
)
MECHANICAL = rx(
    r"\bmechanical\b",
    r"\bthermal\b",
    r"\bthermofluids?\b",
    r"\bfluids?\b",
    r"\bcfd\b",
    r"\bhvac\b",
    r"\bplumbing\b",
    r"\bmechanisms?\b",
    r"\bturbomachinery\b",
    r"\bcad (?:engineer\w*|design\w*)",
    r"\bproduct design (?:engineer\w*|mechanical)",
    r"\bstructural analysis\b",
)
MANUFACTURING = rx(
    r"\bmanufactur\w*",
    r"\bindustrial\b(?!\s+placement)",
    r"\bprocess engineer\w*",
    r"\bquality engineer\w*",
    r"\bsupplier quality\b",
    r"\bproduction quality\b",
    r"\badditive\b",
    r"\btooling\b",
    r"\bnpi\b",
    r"\bindustrialization\b",
    r"\bcnc\b",
)
AEROSPACE = rx(
    r"\baerospace\b",
    r"\baeronautic\w*",
    r"\bastronautic\w*",
    r"\bpropulsion\b",
    r"\bgnc\b",
    r"\bguidance\b",
    r"\baerodynamic\w*",
    r"\bstructures\b",
    r"\bflight test\b",
    r"\bspacecraft\b",
    r"\brockets?\b",
    r"\bcombustion devices\b",
    # A spacecraft's operators, not an office's (Varda's "Mission Operations
    # Internship").
    r"\bmission (?:operations|control)\b",
)
# The rest of engineering, with no specialty of its own.
ENGINEERING_OTHER = rx(
    r"\bchemical\b",
    r"\bmaterials\b",
    r"\bnuclear\b",
    r"\bbiomedical\b",
    r"\bpetroleum\b",
    r"\bmining engineer\w*",
    r"\bnaval architect\w*",
    r"\bagricultural engineer\w*",
    r"\barchitectural engineer\w*",
    r"\bpower systems?\b",
    r"\bsubstations?\b",
    r"\bpower generation\b",
    r"\btransmission and distribution\b",
    r"\bmidstream\b",
    r"\butilit(?:y|ies)\b",
    r"\bfire protection\b",
    r"\bcommissioning\b",
    r"\brefrigerat\w*",
    # Facilities count only where an engineer works on them: Astera Labs' bare
    # "Facilities Intern" runs offices.
    r"\bengineer\w*\b.*\bfacilit(?:y|ies)\b|\bfacilit(?:y|ies)\b.*\bengineer",
)
ENGINEERING = rx(
    *(p.pattern for p in (CIVIL, MECHANICAL, MANUFACTURING, AEROSPACE, ENGINEERING_OTHER))
)
# Engineering named by what it does, not its degree: "Systems Engineer", "Test
# Engineering Intern", "Controls Engineer". Ranked last, so "Embedded Systems
# Engineer" and "Software Engineer, Test" keep their category.
ENGINEERING_WEAK = rx(
    r"\bsystems engineer\w*",
    r"\btest (?:&|and )?(?:evaluation )?engineer\w*",
    r"\breliability engineer\w*",
    r"\bcontrols? engineer\w*",
    r"\bintegration engineer\w*",
    r"\bproject engineer\w*",
    r"\bproduction engineer\w*",
)
# A hardware engineer by name, ahead of the engineering disciplines: Muon Space's
# "GNC Hardware Engineering Intern" builds the hardware, where Rivian's "Hardware
# Thermal Simulation Engineering Intern" does thermal work on it.
HARDWARE_JOB = rx(r"\bhardware engineer\w*")
# Electrical, computer and silicon engineering, RF, optics, avionics, robotics and
# mechatronics: SimplifyJobs' Hardware list.
HARDWARE = rx(
    # Hermeus's "Flight Software Engineering Intern (Simulation/Hardware-In-The-Loop)"
    # is a software job.
    r"\bhardware\b(?![- ]in[- ]the[- ]loop)",
    r"\belectrical\b",
    r"\belectronics?\b",
    r"\belectromagnetics?\b",
    r"\bfpga\b",
    r"\basic\b",
    r"\brtl\b",
    r"\bvlsi\b",
    r"\bsilicon\b",
    r"\bsemiconductors?\b",
    r"\bphysical design\b",
    r"\bdesign verification\b",
    r"\bdigital design\b",
    r"\bdv engineer\w*",
    r"\bdft\b",
    r"\bmixed[- ]signal\b",
    r"\banalog\b",
    r"\bsignal integrity\b",
    r"\bcircuits?\b",
    r"\bpcb\b",
    r"\brf\b",
    r"\bradio frequency\b",
    r"\brfic\b",
    r"\bic design\b",
    r"\bcpu\b",
    r"\bdsp\b",
    r"\bantennas?\b",
    r"\bphotonics?\b",
    r"\boptic(?:s|al)\b",
    r"\bavionics\b",
    r"\bmechatronics?\b",
    r"\bbatter(?:y|ies)\b",
)
# Robotics is hardware only when no software word claims the title first:
# Neuralink's "Software Engineer Intern, Robotics" writes software.
ROBOTICS = rx(r"\brobotics?\b")
# Security and IT, software's one specialty, a help desk included (the IT job most
# students start in). Information technology is spelled in capitals, so the word
# "it" never counts. Personnel, physical and national security are not computer
# security, and a clearance is a requirement.
SECURITY_IT = re.compile(
    r"(?i:\bcyber\w*|\binfo(?:rmation)?[ -]?sec\w*|\bappsec\b|\bthreat\b|\bpentest\w*"
    r"|\bpenetration test\w*|\bidentity (?:&|and) access\b"
    r"|(?<!physical )(?<!personnel )(?<!national )\bsecurity\b(?! clearance| officer| guard)"
    r"|\binformation technology\b|\bhelp ?desk\b|\bservice ?desk\b|\bdesktop support\b"
    r"|\bsys(?:tems?)? ?admin\w*|\bnetwork administrat\w*|\bnoc\b|\bend user services\b"
    r"|\benterprise technology\b|\bbusiness systems\b|\bsystems analyst\b"
    r"|\btechnology (?:graduate )?analyst\b)"
    r"|\bIT\b"
)
# Compliance is legal work, held off, after security: "Security Compliance" is
# security, Geotab's "Corporate Compliance Intern" and Capco's "Junior Compliance
# KYC Specialist" are not ours.
COMPLIANCE = rx(r"\bcompliance\b", r"\baml\b", r"\bkyc\b")
# Customer and technical support, held off, named as the job. After security and
# IT, which take a help desk and Instawork's "IT Intern – Gadget & Tech Support
# Operations", and ahead of the hardware a support desk supports (RF-SMART's
# "Hardware Support Internship"). After data, so Cresta's "Data Science Intern
# (Customer Success)" is data science.
SUPPORT = rx(
    r"\b(?:customer|client) (?:support|service|success|experience|care|operations)\b",
    r"\b(?:tech(?:nical)?|hardware|product) support\b",
    r"\bclient services?\b",
)
# Support as a role's name, after software: mthree's "Production Support Engineer |
# Cloud, DevOps & SRE Graduate Programme" is an SRE job.
SUPPORT_ROLE = rx(r"\bsupport (?:engineer\w*|agent|representative|navigator|specialist|analyst)\b")
FINANCE = rx(
    r"\baccount(?:ing|ant|ants)\b",
    r"\baccounts (?:payable|receivable)\b",
    r"\bap/ar\b",
    r"\baudit\w*",
    r"\btax\b",
    r"\bfp&a\b",
    r"\bfinancial planning\b",
    r"\btreasury\b",
    r"(?<!quantitative )\bfinanc\w*",
    r"\binvest(?:ment|ments|ing|or|ors)\b",
    r"\bbank(?:ing|er|ers)\b",
    r"\bequity research\b",
    r"\bprivate equity\b",
    r"\bventure capital\b",
    r"\bvc\b",
    r"\basset management\b",
    r"\bwealth\b",
    r"\bcapital markets\b",
    r"\bcredit\b",
    r"\bunderwrit\w*",
    r"\bactuar\w*",
    r"\bcontroller\b",
    r"\bpayroll\b",
    r"\blending\b",
    r"\bloans?\b",
    r"\bmortgage\b",
    r"\binsurance\b",
    r"\bm&a\b",
    r"\bportfolio management\b",
    r"\brisk\b",
    r"\bvaluations?\b",
    r"\barbitrage\b",
    r"\bfundamental (?:research|analyst)",
    r"\bpurchase to pay\b",
)
MARKETING = rx(
    r"\bmarketing\b",
    r"\bcommunications?\b(?!\s+(?:engineer\w*|systems?|hardware|networks?|protocols?))",
    r"\bpublic relations\b",
    r"\bpr\b",
    r"\bsocial media\b",
    r"\bsocial (?:content|commerce)\b",
    r"\bpaid (?:media|social)\b",
    r"\bcontent (?:creat\w*|marketing|strateg\w*|production|writer|intern|& communication)",
    r"\bseo\b",
    r"\bcopywrit\w*",
    r"\badvertis\w*",
    r"\bad ?ops\b",
    r"\bbrand\b",
    r"\bmedia (?:planning|planner|buy\w*|marketing|relations)\b",
    r"\bvideo buy\w*",
    r"\bcreative strategist\b",
    r"\binfluencer\b",
    r"\baffiliate\b",
    r"\bdemand gen\w*",
    r"\blead gen\w*",
    r"\bgrowth marketing\b",
    r"\bmarket research\b",
    r"\bconsumer insights\b",
    r"\bcompetitive intelligence\b",
    r"\bcommunity (?:manag\w*|engagement|relations)\b",
    r"\bdeveloper relations\b",
    r"\bdevrel\b",
    r"\bprogrammatic\b",
)
BUSINESS = rx(
    r"\bbusiness operations\b",
    r"\bpmo\b",
    r"\bbiz ?ops\b",
    r"\bstrategy (?:&|and) operations\b",
    r"\bcorporate (?:development|strategy)\b",
    r"\boperations (?:analyst|associate|intern\w*|co-?op|coordinator|management)\b",
    r"\bplanning analyst\b",
    r"\bchief of staff\b",
    r"\bfounders?'?s? associate\b",
    r"\boffice of the ceo\b",
    r"\bbusiness administrat\w*",
    r"\bchange management\b",
    r"\boperational excellence\b",
    r"\brevenue operations\b",
    r"\bmanagement trainee\b",
)
# The words a business title is named by when nothing else names it: Robinhood's
# "Crypto Operations Intern", Zopa's "2027 Graduate Analyst". Never on an
# engineer's or a scientist's title: K2 Space's "Vehicle Operations Engineering
# Intern" and Ginkgo's "Automation Scientist Intern, RAC Operations" are not
# business jobs, whatever else they are.
BUSINESS_WEAK = rx(r"\boperations?\b", r"\bstrateg\w*", r"\banalysts?\b")
OTHER_JOB = rx(
    r"\bengineer\w*",
    r"\bscientists?\b",
    r"\bresearchers?\b",
    r"\bchemists?\b",
    r"\bphysicists?\b",
    r"\bdevelopers?\b",
)
# The arts, held off: Duolingo's "Illustrator, Intern", 2K's "Technical Art Graduate
# Program", a videographer, a podcast producer. Not "3D" or "film": Applied
# Intuition's "Research Intern - 3D Vision" and Periodic Labs' "Research Intern,
# Thin Films" are science.
ART = rx(
    r"\bartists?\b",
    r"\b(?:technical|concept|3d) art\b",
    r"\billustrat\w*",
    r"\banimators?\b",
    r"\bvideograph\w*",
    r"\bphotograph\w*",
    r"\bfilmmak\w*",
    r"\bmusic\b",
    r"\bfashion\b",
    r"\bjournalis\w*",
    r"\breporters?\b",
    r"\bwriters?\b",
    r"\beditors?\b",
    r"\beditorial\b",
    r"\bgame design\w*",
    r"\blevel design\w*",
    r"\bpodcast\w*",
    r"\bvfx\b",
)
# Public policy and government relations, held off. Not a robot's "policy
# learning", which is machine learning (ML ranks first anyway).
PUBLIC = rx(
    r"\bpolicy\b(?! learning)",
    r"\bgovernment (?:affairs|relations)\b",
    r"\bpublic (?:affairs|policy|health)\b",
    r"\blegislat\w*",
    r"\bcongress\w*",
    r"\bpolitical\b",
)
EDUCATION = rx(
    r"\bteach\w*",
    r"\btutor\w*",
    r"\binstructors?\b",
    r"\bcurriculum\b",
    r"\beducat\w*",
)
# Never ours, whatever else the title names: trades and operators, not engineers
# (InfraServices' "Electrical Apprentice", Silvus's "Electronics Test and Assembly
# Technician", Faraday Future's "Robotics Data Operator Intern", Nexus's
# "Electrical Drafter/Designer"), medicine, and a hotel's kitchen and front desk
# (Belmond's "Internship for Train Operations - F&B").
NEVER = rx(
    r"\belectrical apprentice\b",
    r"\btechnicians?\b",
    r"\boperators?\b",
    r"\bdrafter\b",
    r"\bnurse\b",
    r"\bdentist\b",
    r"\bphysician\b",
    r"\bf&b\b",
    r"\bkitchen\b",
    r"\bhousekeeping\b",
    r"\bfront office\b",
    r"\bguest experience\b",
)

#: A held-off discipline: a title it is first in is not kept.
HELD = None

# Which discipline a title is in, first match wins. Job names first (a recruiter
# of quants recruits, a designer of products designs), then the disciplines from
# most specific to least, then the modifiers that only name a job nothing else
# does. A HELD row drops the title: those are fields we hold off on (KAN-172).
CATEGORIES: tuple[tuple[Tag | None, re.Pattern[str]], ...] = (
    (Tag.HR, HR),
    (HELD, LEGAL),
    (Tag.SALES, SALES),
    (Tag.DESIGN, DESIGN),
    (Tag.BUSINESS, PROJECTS),
    (Tag.QUANT, QUANT),
    (Tag.PRODUCT, PRODUCT),
    # Machine learning outranks what it runs on: IMC's "Hardware Machine Learning
    # PhD Research Internship" is data. SimplifyJobs files data engineers (665 of
    # 666) and analysts (1,063 of 1,064) here, not under Software.
    (Tag.DATA_AI, rx(ML.pattern, DATA_SCIENCE.pattern, DATA_ENGINEERING.pattern)),
    (Tag.DATA_AI, ANALYTICS),
    (Tag.HARDWARE, EMBEDDED),
    (Tag.SOFTWARE, SOFTWARE),
    (HELD, CONSULTING),
    (Tag.SOFTWARE, SECURITY_IT),
    (HELD, SUPPORT),
    (Tag.BUSINESS, SUPPLY),
    (Tag.HARDWARE, HARDWARE_JOB),
    (Tag.ENGINEERING, ENGINEERING),
    (Tag.HARDWARE, HARDWARE),
    (Tag.SALES, PARTNERS),
    (HELD, SUPPORT_ROLE),
    (HELD, COMPLIANCE),
    (Tag.FINANCE, FINANCE),
    (Tag.MARKETING, MARKETING),
    (Tag.BUSINESS, BUSINESS),
    (HELD, ART),
    (HELD, PUBLIC),
    (HELD, EDUCATION),
    # The modifiers. Software's generic words before the rest, as they always
    # were: "QA Interns || Robotics" (Instawork) is QA.
    (Tag.SOFTWARE, SOFTWARE_WEAK),
    (Tag.HARDWARE, ROBOTICS),
    (Tag.DATA_AI, AI),
    (Tag.QUANT, TRADING),
    (Tag.ENGINEERING, ENGINEERING_WEAK),
)

# A second category, only for the engineering jobs that are two at once (KAN-172):
# an ML, AI or data engineer writes software (Cresta's "Machine Learning
# Engineering Intern", Figma's "Data Engineer Intern"), so does a firmware or
# embedded engineer (Graphcore's "Graduate Firmware Engineer") and a quant
# developer (Walleye's "Quantitative Developer Intern"). A research engineer
# researches. Weak words never add one: "AI" on a software title is its team.
SOFTWARE_JOB = rx(
    r"\bsoftware (?:engineer\w*|develop\w*)",
    r"(?<!business )\bdeveloper\b(?!\s+(?:relations|advocate|community|marketing))",
    r"\bprogrammer\b",
    r"\bswe\b",
    r"\bfull[- ]?stack\b",
    r"\bback[- ]?end\b",
    r"\bfront[- ]?end\b",
)
SECOND = {
    Tag.DATA_AI: rx(
        r"\b(?:ml|learning|ai|a\.i\.|artificial intelligence|computer vision|perception|nlp|llm"
        r"|mlops|inference|data|analytics)[\s/&-]+"
        r"(?:software\s+|infrastructure\s+|platform\s+)?(?:engineer\w*|developer)\b",
        SOFTWARE_JOB.pattern,
    ),
    Tag.HARDWARE: rx(
        r"\b(?:embedded|firmware)\s+(?:systems?\s+)?(?:software\s+)?(?:engineer\w*|developer)\b",
        SOFTWARE_JOB.pattern,
    ),
    Tag.QUANT: rx(
        r"\bquant\w*\s+(?:software\s+|trading\s+|systems\s+)?"
        r"(?:engineer\w*|developer|development|dev)\b",
        SOFTWARE_JOB.pattern,
    ),
}
_NOT_SECOND = rx(r"\bresearch engineer\w*")

# A specialty is named in a role's title within one of its categories.
SPECIALTIES: dict[Tag, tuple[tuple[Tag, re.Pattern[str]], ...]] = {
    Tag.SOFTWARE: ((Tag.SECURITY_IT, SECURITY_IT),),
    Tag.DATA_AI: (
        (Tag.ML, rx(ML.pattern, AI.pattern, r"\binference\b", r"\bneural\b")),
        (Tag.DATA_SCIENCE, DATA_SCIENCE),
        (Tag.ANALYTICS, ANALYTICS),
        (Tag.DATA_ENGINEERING, DATA_ENGINEERING),
    ),
    Tag.ENGINEERING: (
        (Tag.CIVIL, CIVIL),
        (Tag.MECHANICAL, MECHANICAL),
        (Tag.MANUFACTURING, MANUFACTURING),
        (Tag.AEROSPACE, AEROSPACE),
    ),
}


def first_category(title: str) -> Tag | None:
    """The first discipline the title names, or None for a title naming none of
    ours or one we hold off on."""
    if NEVER.search(title):
        return None
    for tag, pattern in CATEGORIES:
        if pattern.search(title):
            return tag
    if BUSINESS_WEAK.search(title) and not OTHER_JOB.search(title):
        return Tag.BUSINESS
    return None


def categories(title: str) -> tuple[Tag, ...]:
    """The role's categories, first first, then its specialties; () if none."""
    first = first_category(title) if title else None
    if first is None:
        return ()
    found = [first]
    second = SECOND.get(first)
    if second and second.search(title) and not _NOT_SECOND.search(title):
        found.append(Tag.SOFTWARE)
    specialties = [
        specialty
        for category in found
        for specialty, pattern in SPECIALTIES.get(category, ())
        if pattern.search(title)
    ]
    return (*found, *specialties)


def classify(title: str) -> tuple[Tag, ...]:
    """(stage, category, [second category], *specialties) for a title, or an empty
    tuple if it does not belong."""
    at = stage(title)
    found = categories(title) if at else ()
    # A recruiter's stage is the person's own, never the program they recruit for:
    # Path Robotics' "Early Career & University Relations Recruiter".
    if not found or (found[0] is Tag.HR and not at.personal):
        return ()
    return (at.tag, *found)


@dataclass(frozen=True, slots=True)
class Role:
    """One distinct role on the page, possibly standing for several postings."""

    title: str
    company: str
    #: The lead copy's (`_lead`): the oldest, or a Workday job's student site.
    apply_url: str
    ats: str
    #: The lead copy's board -- whose logo the feed shows.
    board_key: str
    #: `classify`'s answer: the stage, one or two categories, then any specialties.
    tags: tuple[Tag, ...]
    posted_at: str | None
    #: No posting behind this role was known to us before today. See `Store.is_new`.
    new: bool
    department: str | None
    locations: tuple[str, ...]
    description: str | None
    #: The lead copy's facts (or, with no page, the first copy's that has one),
    #: whole, with `work_style` and `job_type` as the card shows them: stated, or
    #: inferred (see `_work_style` and `_job_type`).
    facts: Facts = field(default_factory=Facts)

    @property
    def category(self) -> Tag:
        """The role's first category; `classify` puts it after the stage."""
        return self.tags[1]

    @property
    def roles(self) -> tuple[str, ...]:
        """Its category and specialty keys, first category first: `feed.json`'s
        `roles`, which the Jobs page filters on."""
        return tuple(tag.value for tag in self.tags[1:])

    @property
    def location_label(self) -> str:
        if not self.locations:
            return ""
        if len(self.locations) == 1:
            return self.locations[0]
        return f"{len(self.locations)} locations"


def pick(jobs: list[Job], *, is_new: Callable[[Job], bool]) -> list[Role]:
    """Classify, dedupe, and order newest-first by the provider's posted date."""
    # Every work style a company's postings state, for its postings that state none.
    styles: dict[str, Counter[str]] = {}
    for job in jobs:
        if job.facts.work_style:
            styles.setdefault(job.company, Counter())[job.facts.work_style] += 1
    # Copies at one URL are one posting. So are the URLs of one Workday
    # requisition on several of a company's careers sites (`_requisition`).
    by_url: dict[str, list[Job]] = {}
    for job in jobs:
        by_url.setdefault(job.apply_url, []).append(job)
    grouped: dict[str | tuple[str, str, str], list[Job]] = {}
    for url, copies in by_url.items():
        grouped.setdefault(_requisition(copies) or url, []).extend(copies)

    roles = []
    for copies in grouped.values():
        # The oldest copy says whether the role is new: it has been known to us since
        # we first saw *any* of its copies, so it is new only if that copy is.
        oldest = min(copies, key=_age)
        # The lead copy says what the role is and where to apply, and goes first.
        lead = _lead(copies, oldest)
        postings = [lead, *(job for job in copies if job is not lead)]
        tags = classify(lead.title)
        if not tags:
            continue
        locations = tuple(dict.fromkeys(place for job in postings for place in job.places))
        # Facts come whole from one copy, never field by field across copies:
        # pay from one and job type from another would describe no posting.
        facts = next((job.facts for job in postings if job.page), Facts())
        roles.append(
            Role(
                title=lead.title,
                company=lead.company,
                apply_url=lead.apply_url,
                ats=lead.ats,
                board_key=lead.board_key,
                tags=tags,
                posted_at=min((job.posted_at for job in postings if job.posted_at), default=None),
                new=is_new(oldest),
                department=next((job.department for job in postings if job.department), None),
                locations=locations,
                description=next((job.description for job in postings if job.description), None),
                facts=replace(
                    facts,
                    work_style=_work_style(postings, styles.get(lead.company)),
                    job_type=_job_type(tags, facts),
                ),
            )
        )
    # None sorts last: a posting with no date is not a brand new one.
    return sorted(
        roles, key=lambda role: (role.posted_at is not None, role.posted_at or ""), reverse=True
    )


def _age(job: Job) -> tuple[bool, str]:
    """Oldest first by `first_seen_at`; unstamped sort last."""
    return job.first_seen_at is None, job.first_seen_at or ""


def _requisition(copies: list[Job]) -> tuple[str, str, str] | None:
    """The job a Workday posting is a copy of: its company, its tenant (where a
    requisition number is unique) and the number its own record states.

    A company can run several careers sites and post one requisition on more
    than one: Autodesk's interns are on `ext` and `uni`, Cadence's on up to three
    sites. Each copy has its own URL, but it is one job and one application, so
    one role. Only Workday, and only the record's number (`describe_workday`): a
    Workday posting whose record was not read keeps its own URL, and every other
    provider's copies are one job only at one URL (Stripe's seven offices).
    """
    for job in copies:
        if job.ats == "workday" and job.page and job.page.requisition:
            return job.company, job.token.split("/")[0], job.page.requisition
    return None


# A careers site built for students, by its name: Autodesk's `uni`, Cadence's
# `univ_careers` and `university_talent_intern`, BMO's and CIBC's `campus`,
# Boeing's `intern`, Becton Dickinson's `us_early_talent_site`, and run together
# (`bpearlycareers`, `futureforce_newgradroles`). Not `international_career_site`,
# `internaljobs`, `earlywarningcareers` or `unilever_...`. All are boards.csv names.
STUDENT_SITE = re.compile(
    r"(?<![a-z])uni(?![a-z])|univ|campus|student|intern(?!al|ation)|early[_-]?(?:career|talent)"
    r"|newgrad|grad(?:uates?)?(?![a-z])|college|entry[_-]?level"
)


def _lead(copies: list[Job], oldest: Job) -> Job:
    """The copy a role links to and is described by.

    Copies at one URL are one posting, so the oldest. A Workday job on several
    careers sites links the one whose name says it is for students
    (`STUDENT_SITE`): the employer made that site for exactly this applicant. The
    copies describe one job (35 of the 36 found on 2026-10-10 read word for word
    alike; Autodesk's Oslo role differs only in each site's footer), so the choice
    loses nothing, and nothing else prefers one: the curated lists link both. A
    private site (`private_postings_intern_conversion_only`) is not for everyone.
    Then the oldest, then by URL, so a role keeps its link from run to run.
    """
    if len({job.apply_url for job in copies}) == 1:
        return oldest
    return min(copies, key=lambda job: (not _for_students(job), _age(job), job.apply_url))


def _for_students(job: Job) -> bool:
    site = job.token.rsplit("/", 1)[-1].lower()
    return "private" not in site and bool(STUDENT_SITE.search(site))


# Words that make "On site" a guess too far: the posting allows something else.
# Only remote or hybrid *work*: "remote battery monitoring", "hybrid cloud" and
# "remote access VPNs" say nothing about where the job is done.
FLEXIBLE = re.compile(
    r"\bremote(?:ly)?\b(?!\s+(?:battery|access|sensing|monitoring|control|devices?|systems?"
    r"|sites?|vehicles?|operations?|support|desktop|server|procedure|management))"
    r"|\bhybrid\b(?!\s+(?:cloud|network|benchmark\w*|system|vehicle|quantum|search|approach to))"
    r"|work from home|\bwfh\b|\bwork from anywhere\b",
    re.I,
)


def _work_style(postings: list[Job], company: Counter[str] | None) -> str | None:
    """The card's work style, first answer wins:

    1. what the posting states -- its board's field or a sentence (`Facts`);
    2. what the company's other postings state, most often;
    3. "On site" when it names a place and nothing in it mentions remote, hybrid
       or working from home.

    Measured on 250 postings whose board states a work style but whose text does
    not: 2 then 3 is right 87% of the time, 3 alone 70% (the misses are hybrid).
    Postings that state nothing usually work on site, and a card that says so is
    more use than "not listed" -- the cost is a hybrid job sometimes shown on site.
    """
    stated = next((job.facts.work_style for job in postings if job.facts.work_style), None)
    if stated:
        return stated
    if company:
        return company.most_common(1)[0][0]
    text = " ".join(f"{job.title} {job.location or ''} {job.description or ''}" for job in postings)
    if any(job.places for job in postings) and not FLEXIBLE.search(text):
        return "On site"
    return None


def _job_type(tags: tuple[Tag, ...], facts: Facts) -> str | None:
    """The card's job type, first answer wins:

    1. what the posting states -- its board's field or a sentence (`Facts`);
    2. "full_time" for a new-grad role.

    Measured on the live feed (2026-10-10): 216 of 216 new-grad roles that state a
    job type say full-time. A stated type always wins, so this never turns a
    part-time or contract posting into a full-time one.

    An internship is not inferred: the Jobs page shows "Internship" as every
    internship's job type, whatever its hours (decided 2026-10-10: a card saying
    "Full-Time Internship" beside "Part-Time Internship" read as two kinds of
    internship). What an internship's posting states is still kept here.
    """
    if facts.job_type:
        return facts.job_type
    if Tag.NEW_GRAD in tags:
        return "full_time"
    return None
