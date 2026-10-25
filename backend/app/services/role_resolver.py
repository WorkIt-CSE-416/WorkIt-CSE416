'''
Turns a job title into the job_roles it names: "Software Engineer (Machine
Learning) Intern - Summer 2027" gives {"software_engineer", "ai_ml_engineer"}.
Pure: no database, no network. The import builds one RoleResolver with the
roles the database holds, so every slug it returns passes job_role_tags'
foreign key. Search runs the same resolver over what a user types
(read_query), so a job is found by the words it was tagged from.

How a title is read, start to finish (docs/search.md has the why):

1. Split into words: accents and case folded, then runs of letters and
   digits. Punctuation and brackets are gone, so only word order is left:
   "Full-Stack Engineer (AI/ML)" is `full stack engineer ai ml`.
2. Normalize word forms with WORD_FORMS, the same table the aliases go
   through: "Software Engineering" meets the alias "software engineer".
3. Walk the words left to right. At each word try the longest alias that
   could start there, then shorter ones; a match records its role and uses up
   its words. Whole words only, never substrings: "Salesforce Developer"
   holds no word "sales".
4. If an OUTRIGHT role matched, keep only those: "Technical Recruiter,
   Software Engineering" is a recruiter job.
5. No alias, no role. A bare "Engineer" or "Intern" names nothing, and nothing
   is forced into a nearest role: a missing tag only means the job is found
   by keyword, a wrong one shows it in a filter where it doesn't belong.

Words that start no alias ("intern", "summer", "2027") are passed over, so
there is no list of them to strip.

A search finds a role by its tag or by the words that named it in a title
(read_query's said, title_pattern): the longest alias takes a title's words,
so "Embedded Software Engineer" is embedded_engineer alone, and a search for
"software" finds it by its title.

A search query (read_query) gets one more step before 2: a typed word that is
in no alias is snapped to the nearest one that is ("sofware" is "software"),
so a typo still finds its role. Titles never are: a job board's title is
spelled as posted, and a guess there would be a stored tag.

Growing the aliases: the import reports titles that resolved to nothing. Add
the phrase to the role here, and a case to tests/test_role_resolver.py first,
as with the location resolver: the aliases interact.
'''
import difflib
import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

# One word, its other spellings. Applied to titles, queries and the aliases
# alike, so one entry here serves every role. A value with a space becomes
# several words ("fullstack" is "full stack").
#
# Only a person's forms, never a process: "development" and "programming" are
# not "developer" and "programmer". Mapping them tagged "Graduate Development
# Program" and "GPU Programming" as software; the processes that do name a
# role ("software development") are aliases instead.
WORD_FORMS = {
    "engineering": "engineer", "engineers": "engineer", "eng": "engineer", "engr": "engineer",
    "developers": "developer", "dev": "developer", "devs": "developer",
    "sw": "software", "hw": "hardware", "infra": "infrastructure",
    "scientists": "scientist", "analysts": "analyst", "designers": "designer",
    "managers": "manager", "mgr": "manager", "programmers": "programmer",
    "researchers": "researcher", "recruiters": "recruiter", "accountants": "accountant",
    "nurses": "nurse", "nursing": "nurse", "teachers": "teacher", "therapists": "therapist",
    "agents": "agent", "internship": "intern", "internships": "intern",
    "fullstack": "full stack", "frontend": "front end", "backend": "back end",
    "cybersecurity": "cyber security",
}

# What titles and searches say for each role, beyond its own name (which is
# always an alias). Each phrase belongs to one role; RoleResolver refuses two
# roles claiming the same one. A phrase longer than another wins where both
# start, which is what keeps short ones safe: "business developer" is sales
# before "developer" is software.
#
# An OUTRIGHT role's phrases name the job, never just its field: "Software
# Engineer, Recruiting Platform" must not lose its software tag to a lone
# "recruiting".
ALIASES: dict[str, tuple[str, ...]] = {
    # engineering
    "software_engineer": (
        "software engineer", "software developer", "software",
        "developer", "programmer", "swe", "sde", "full stack", "back end", "front end",
        "web developer", "web engineer", "ui engineer", "mobile engineer", "mobile developer",
        "ios engineer", "ios developer", "android engineer", "android developer",
        "application developer", "app developer", "software development", "web development",
        "computer science",
    ),
    "ai_ml_engineer": (
        "machine learning", "machine learning engineer", "ml", "ml engineer", "ai ml", "ml ai",
        "ai engineer", "artificial intelligence", "deep learning", "computer vision", "nlp",
        "natural language processing", "llm", "applied ai", "generative ai", "genai", "mlops",
        "ai agent", "agentic ai", "robot learning",
    ),
    "data_engineer": (
        "data engineer", "engineer data", "data platform", "analytics engineer", "etl",
        "database engineer", "big data",
    ),
    "infrastructure_engineer": (
        "infrastructure", "devops", "developer ops", "sre", "site reliability", "platform engineer",
        "cloud engineer", "cloud infrastructure", "systems administrator", "system administrator",
        "sysadmin", "network engineer", "database administrator", "dba", "cloud operations",
    ),
    "security_engineer": (
        "security", "cyber security", "infosec", "information security", "penetration tester",
        "pentester", "appsec", "application security",
    ),
    "qa_engineer": (
        "qa", "quality assurance", "sdet", "software test", "software tester",
        "software quality", "software quality engineer", "test automation", "automation test",
    ),
    "quality_engineer": (
        "quality engineer", "quality control", "supplier quality", "manufacturing quality",
        "quality inspector", "quality technician",
    ),
    "solutions_engineer": (
        "solutions engineer", "solution engineer", "forward deployed", "sales engineer",
        "customer engineer", "implementation engineer", "field application engineer",
        "field applications engineer", "fde",
    ),
    "hardware_engineer": (
        "hardware", "asic", "fpga", "silicon", "chip", "vlsi", "rtl", "design verification",
        "ic design", "digital design", "analog design", "dsp", "rf engineer", "photonics",
        "radio frequency",
    ),
    "embedded_engineer": (
        "embedded", "firmware", "embedded software", "embedded systems", "firmware development",
    ),
    "robotics_engineer": ("robotics", "mechatronics", "robot", "autonomy engineer"),
    "electrical_engineer": ("electrical", "electronics engineer", "power systems engineer"),
    "mechanical_engineer": (
        "mechanical", "mechanical design", "turbomachinery", "thermal engineer",
        "thermal simulation", "product design engineer",
    ),
    "aerospace_engineer": (
        "aerospace", "aeronautical", "astronautical", "propulsion", "avionics", "gnc",
        "guidance navigation and controls", "guidance navigation and control", "flight test",
        "mission operations", "spacecraft", "launch engineer",
    ),
    "manufacturing_engineer": (
        "manufacturing", "process engineer", "production engineer", "tooling engineer",
    ),
    "industrial_engineer": ("industrial engineer", "industrial and systems engineer"),
    "systems_engineer": ("systems engineer", "system engineer", "systems engineering intern"),
    "chemical_engineer": ("chemical", "materials engineer", "nuclear engineer"),
    "civil_engineer": (
        "civil", "transportation engineer", "geotechnical", "water resources engineer",
        "construction engineer", "roadway", "survey intern", "surveyor", "environmental engineer",
        "water infrastructure",
    ),
    "structural_engineer": ("structural", "structures engineer"),
    # data and research
    "data_scientist": ("data science", "applied scientist", "decision scientist"),
    "data_analyst": (
        "analytics", "data analytics", "business intelligence", "bi analyst", "research analyst",
    ),
    "research_scientist": (
        "research", "researcher", "research intern", "applied research", "ai scientist",
    ),
    "research_engineer": ("research software engineer", "research and development"),
    "quantitative_analyst": (
        "quant", "quantitative", "quant researcher", "quantitative researcher", "quant research",
        "quantitative research", "alpha research", "quant developer", "quantitative developer",
        "trader", "quantitative trading", "algorithmic trading",
    ),
    # product
    "product_manager": (
        "product manager", "product management", "associate product manager", "apm",
        "product owner", "product operations",
    ),
    "product_designer": (
        "product design", "ux designer", "ui designer", "ui ux", "ux ui", "ux design",
        "ux research", "ux researcher", "user research", "user experience", "interaction designer",
        "web designer",
    ),
    "graphic_designer": (
        "graphic design", "visual designer", "visual design", "brand designer", "motion designer",
        "illustrator",
    ),
    "industrial_designer": ("industrial design",),
    # business
    "business_analyst": ("business analysis", "business systems analyst"),
    "operations_analyst": (
        "business operations", "bizops", "strategy and operations", "operations analyst",
        "operations associate", "operations intern", "trading operations", "strategy analyst",
        "strategy intern", "deployment strategist", "operations coordinator",
    ),
    "project_manager": (
        "program manager", "project coordinator", "program coordinator", "program management",
        "project management", "technical program manager", "tpm",
    ),
    "supply_chain_analyst": (
        "supply chain intern", "supply chain associate", "supply chain coordinator",
        "supply chain planner", "procurement", "sourcing",
        "logistics intern", "logistics analyst", "logistics coordinator", "buyer", "purchasing",
        "demand planning", "inventory analyst",
    ),
    # finance
    "financial_analyst": (
        "finance intern", "finance analyst", "finance associate", "fp a",
        "corporate finance", "treasury analyst", "treasury intern", "financial planning",
    ),
    "investment_banking_analyst": (
        "investment banking", "investment banker", "mergers and acquisitions", "m a",
        "capital markets", "leveraged finance",
    ),
    "investment_analyst": (
        "investment intern", "investment associate", "private equity", "venture capital",
        "equity research", "asset management", "wealth management", "portfolio analyst",
        "hedge fund",
    ),
    "risk_analyst": (
        "risk intern", "risk management", "credit analyst", "credit risk", "underwriter",
        "underwriting",
    ),
    "actuary": ("actuarial", "actuarial analyst", "actuarial intern"),
    "accountant": (
        "accounting intern", "accounting associate", "accounting analyst", "staff accountant",
        "cpa", "bookkeeper", "auditor", "audit associate", "tax associate", "audit intern",
        "tax intern", "audit associate intern",
    ),
    "marketing_specialist": (
        "marketing coordinator", "marketing manager", "marketing associate", "marketing intern",
        "marketing analyst", "product marketing", "growth marketing", "digital marketing",
        "content marketing", "brand manager", "social media manager", "seo specialist",
        "social media intern", "social media coordinator", "social media specialist",
        "copywriter", "content writer", "media planning", "media planner", "media buyer",
        "communications intern", "communications specialist", "public relations",
        "video buyer", "developer community",
    ),
    "sales_representative": (
        "sales rep", "sales associate", "sales intern", "sales manager", "sales specialist",
        "sales development", "sdr", "bdr", "inside sales", "account executive", "account manager",
        "business developer", "business development", "software sales", "technical sales",
        "partnerships intern", "partnerships associate", "sales partner",
    ),
    "recruiter": (
        "recruiting coordinator", "recruiting intern", "talent acquisition", "talent partner",
        "sourcer", "recruiting associate",
    ),
    "hr_specialist": (
        "hr intern", "hr coordinator", "hr generalist", "hr associate",
        "human resources intern", "human resources assistant", "human resources coordinator",
        "people operations", "people partner", "total rewards",
        "talent scientist",
    ),
    # healthcare
    "nurse": ("registered nurse", "rn", "lpn", "nurse practitioner"),
    "psychologist": ("psychology", "clinical psychologist", "school psychologist"),
    "clinician": (
        "therapist", "counselor", "physician assistant", "occupational therapist",
        "physical therapist", "clinical social worker",
    ),
    # education
    "teacher": ("teaching assistant", "teaching fellow", "tutor", "instructor", "educator"),
    # retail and real estate
    "store_manager": (
        "assistant store manager", "retail manager", "retail store manager", "shop manager",
        "store supervisor",
    ),
    "real_estate_agent": (
        "realtor", "real estate associate", "real estate salesperson", "real estate broker",
        "leasing agent", "leasing consultant",
    ),
}

# Phrases that look like a role and aren't, as words to pass over: an alias
# that tags nothing. "UIUC Research Park" is a place, "Hardware-In-The-Loop" a
# kind of testing, "(Embedded Science Team)" a team name, and a bank's
# "Infrastructure M&A" or "Infrastructure Finance" a deal group.
NOT_ROLES = (
    "research park", "hardware in the loop", "embedded science",
    "infrastructure m a", "infrastructure advisory", "infrastructure finance",
    "infrastructure investment", "infrastructure investing",
)

# Roles whose title is the job itself, with any field words only saying which
# area it serves ("Product Manager, Machine Learning Platform"). When one
# matches, the other roles the title names are dropped.
OUTRIGHT = frozenset({
    "product_manager", "product_designer", "graphic_designer", "industrial_designer",
    "project_manager", "marketing_specialist", "sales_representative", "recruiter",
    "hr_specialist", "teacher", "store_manager", "real_estate_agent",
})

# Typo correction in read_query. Words shorter than FUZZY_MIN_LENGTH are left
# as typed: at that length nearly everything is close to something ("ml" and
# "qa", "rn" and "rtl"), and the short ones that matter are abbreviations,
# which WORD_FORMS and the aliases spell out exactly. FUZZY_CUTOFF is
# difflib's ratio: 0.8 takes "engingger" to "engineer" (0.82).
FUZZY_MIN_LENGTH = 5
FUZZY_CUTOFF = 0.8

_WORD = re.compile(r"[a-z0-9]+")


def title_pattern(said: Iterable[str]) -> str:
    '''
    a Postgres regular expression (for ~*) finding these words, in this
    order, as whole words in a title, each in any spelling WORD_FORMS gives
    it: ("software", "engineer") finds "Embedded Software Engineering" and
    "SW-Engineers". Words, not stems: the english stemmer makes "developer"
    and "development" one lexeme, which WORD_FORMS keeps apart on purpose.
    Nothing or punctuation may come between two words, so a run that is one
    word in a title ("fullstack", "frontend") is found too. Words are letters
    and digits only (raw_words), so none needs escaping
    '''
    def spellings(w: str) -> str:
        return "|".join([w, *(raw for raw, form in WORD_FORMS.items() if form == w)])
    return r"\m" + r"\W*".join(f"(?:{spellings(w)})" for w in said) + r"\M"


def raw_words(text: str) -> list[str]:
    '''
    accents and case folded, then runs of letters and digits
    '''
    folded = unicodedata.normalize("NFKD", text)
    folded = "".join(c for c in folded if not unicodedata.combining(c)).casefold()
    return _WORD.findall(folded)


def raw_word_spans(text: str) -> list[tuple[int, int]]:
    '''
    where each of raw_words' words stands in text as typed, start and end.
    Folded a character at a time, which folds the same as the whole text at
    once, so each folded character keeps the place it came from
    '''
    folded: list[str] = []
    origin: list[int] = []   # folded index -> text index
    for i, c in enumerate(text):
        f = "".join(x for x in unicodedata.normalize("NFKD", c) if not unicodedata.combining(x))
        for x in f.casefold():
            folded.append(x)
            origin.append(i)
    return [(origin[m.start()], origin[m.end() - 1] + 1) for m in _WORD.finditer("".join(folded))]


def words(text: str) -> list[str]:
    '''
    the form every title, query and alias is compared in
    '''
    return [w for raw in raw_words(text) for w in WORD_FORMS.get(raw, raw).split()]


@dataclass(frozen=True)
class QueryRoles:
    roles: frozenset[str]
    # The words of the query no role used, as typed (folded): what keyword and
    # company search look for. "swe intern stripe" leaves ("intern", "stripe").
    rest: tuple[str, ...]
    # Each role, the phrases that named it, corrected and in their word forms:
    # "sofware enginer" gives {"software_engineer": (("software", "engineer"),)}.
    # Search matches a title saying them (title_pattern) as well as the tag,
    # so a job tagged with another role for the same words ("Embedded
    # Software Engineer" is embedded_engineer) is still found.
    said: Mapping[str, tuple[tuple[str, ...], ...]] = field(default_factory=dict)


class RoleResolver:
    '''
    roles: the job_roles the database holds, slug mapped to name. Each name is
    an alias of its own role. An alias, or an OUTRIGHT entry, for a slug not
    among them is a ValueError: the import fails rather than write a tag the
    foreign key rejects.
    '''

    def __init__(
        self,
        roles: Mapping[str, str],
        aliases: Mapping[str, Iterable[str]] = ALIASES,
        outright: Iterable[str] = OUTRIGHT,
        not_roles: Iterable[str] = NOT_ROLES,
    ):
        unknown = (set(aliases) | set(outright)) - set(roles)
        if unknown:
            raise ValueError(f"role aliases name slugs job_roles doesn't hold: {sorted(unknown)}")
        self._outright = frozenset(outright)

        # words -> slug, or "" for a phrase that is no role (NOT_ROLES)
        self._phrases: dict[tuple[str, ...], str] = {}
        entries = [(slug, phrase) for slug, name in roles.items()
                   for phrase in (name, *aliases.get(slug, ()))]
        entries += [("", phrase) for phrase in not_roles]
        for slug, phrase in entries:
            key = tuple(words(phrase))
            if not key:
                raise ValueError(f"alias {phrase!r} of {slug or 'NOT_ROLES'} has no words")
            owner = self._phrases.setdefault(key, slug)
            if owner != slug:
                raise ValueError(
                    f"{' '.join(key)!r} is claimed by both {owner or 'NOT_ROLES'} "
                    f"and {slug or 'NOT_ROLES'}"
                )
        self._longest = max(map(len, self._phrases), default=0)
        # what a typed word may be corrected to: any word of a phrase, or a
        # WORD_FORMS spelling, which the forms then normalize as usual
        self._known = frozenset(w for key in self._phrases for w in key) | set(WORD_FORMS)
        self._known_list = sorted(self._known)

    def _walk(self, ws: list[str]) -> list[tuple[str, range]]:
        '''
        each alias found: its role, and the positions in ws it used. A role
        dropped for an OUTRIGHT one gives its words back, so a search for
        "software recruiter" still looks for "software"
        '''
        matches: list[tuple[str, range]] = []
        i = 0
        while i < len(ws):
            for n in range(min(self._longest, len(ws) - i), 0, -1):
                slug = self._phrases.get(tuple(ws[i:i + n]))
                if slug is not None:
                    if slug:   # "" passes over a NOT_ROLES phrase, words unused
                        matches.append((slug, range(i, i + n)))
                    i += n
                    break
            else:
                i += 1
        if any(slug in self._outright for slug, _ in matches):
            matches = [m for m in matches if m[0] in self._outright]
        return matches

    def resolve(self, title: str) -> frozenset[str]:
        '''
        the roles a job title names; empty when it names none
        '''
        return frozenset(slug for slug, _ in self._walk(words(title)))

    def _correct(self, raw: str) -> str:
        '''
        a typed word in no alias, as the nearest word that is; unchanged when
        it is known, short, or close to nothing
        '''
        if raw in self._known or len(raw) < FUZZY_MIN_LENGTH:
            return raw
        close = difflib.get_close_matches(raw, self._known_list, n=1, cutoff=FUZZY_CUTOFF)
        return close[0] if close else raw

    def read_query(self, text: str) -> QueryRoles:
        '''
        the roles a search names, and the words left for keyword search. A
        corrected word that ends up in no alias is left in rest as typed, so
        a company or keyword that happens to look like an alias word
        ("scale" is close to "sales") is still searched for
        '''
        raws = raw_words(text)
        ws: list[str] = []
        origin: list[int] = []   # ws index -> the raw word it came from
        for r, raw in enumerate(raws):
            known = self._correct(raw)
            for w in WORD_FORMS.get(known, known).split():
                ws.append(w)
                origin.append(r)
        matches = self._walk(ws)
        said: dict[str, tuple[tuple[str, ...], ...]] = {}
        for slug, span in matches:
            # a role named twice ("swe software") is two phrases, not one
            said[slug] = (*said.get(slug, ()), tuple(ws[i] for i in span))
        used_raw = {origin[i] for _, span in matches for i in span}
        return QueryRoles(
            frozenset(said),
            tuple(w for r, w in enumerate(raws) if r not in used_raw),
            said,
        )
