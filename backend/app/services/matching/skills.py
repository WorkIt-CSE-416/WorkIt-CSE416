"""
Skills: the vocabulary a match is made in, and reading it out of text.

Postings and resumes are both free text, so both are read against one fixed vocabulary of skills.

"""

from os import name
import re
from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class Skill:
    name: str
    roles: tuple[str, ...]
    aliases: tuple[str, ...]
    cased: tuple[str, ...]
    strict: tuple[str, ...]
    implies: tuple[str, ...]


def _skill(
    name: str,
    roles: str = "",
    *aliases: str,
    cased: tuple[str, ...] = (),
    strict: tuple[str, ...] = (),
    implies: tuple[str, ...] = (),
) -> Skill:
    return Skill(name, tuple(roles.split()), aliases, cased, strict, implies)


VOCABULARY: tuple[Skill, ...] = (
    # Languages
    _skill("Python", "swe", "Python3"),
    _skill("Java", "swe"),
    _skill("C", "swe embedded", strict=("C",)),
    _skill("C++", "swe embedded", "cpp"),
    _skill("C#", "swe", "csharp"),
    _skill("Go", "swe backend", "golang", strict=("Go",)),
    _skill("Rust", "swe", cased=("Rust",)),
    _skill("JavaScript", "swe frontend", "JS", "ES6"),
    _skill("TypeScript", "swe frontend", implies=("JavaScript",)),
    _skill("SQL", "data_science data_eng backend"),
    _skill("R", "data_science", strict=("R",)),
    _skill("HTML", "frontend", "HTML5"),
    _skill("CSS", "frontend", "CSS3", "Sass", "SCSS"),
    # Frameworks
    _skill("React", "frontend", "React.js", "ReactJS", cased=("React",), implies=("JavaScript",)),
    _skill("React Native", "mobile frontend", implies=("React",)),
    _skill("Node.js", "backend", "NodeJS", cased=("Node",), implies=("JavaScript",)),
    _skill("Express", "backend", "Express.js", "ExpressJS", strict=("Express",), implies=("Node.js",)),
    _skill("Spring Boot", "backend", "SpringBoot", strict=("Spring",), implies=("Java",)),
    _skill("Django", "backend", implies=("Python",)),
    # Data
    _skill("PostgreSQL", "backend data_eng", "Postgres", implies=("SQL",)),
    _skill("Spark", "data_eng", "Apache Spark", "PySpark", cased=("Spark",)),
    _skill("Excel", "data_science business", "Microsoft Excel", cased=("Excel",)),
    # Machine learning
    _skill("Machine Learning", "ml", cased=("ML",)),
    _skill("Deep Learning", "ml", "neural networks", "neural network", implies=("Machine Learning",)),
    _skill("PyTorch", "ml", implies=("Python", "Deep Learning")),
    _skill("LLMs", "ml", "LLM", "large language model", "large language models", implies=("Machine Learning",)),
    # Infrastructure
    _skill("AWS", "infra", "Amazon Web Services"),
    _skill("Docker", "infra"),
    _skill("Kubernetes", "infra", "k8s"),
    _skill("CI/CD", "infra", "continuous integration", "continuous delivery", "continuous deployment"),
    _skill("Git", "swe"),
    _skill("Linux", "infra embedded"),
    # Phrases only: "networking" alone is usually the social kind.
    _skill("Computer Networking", "infra", "computer networks", "network protocols", "TCP/IP"),
    # Phrases only: "embedded" alone is usually English ("embedded in the team").
    _skill("Embedded Systems", "embedded", "embedded system", "embedded software"),
    # Topics, mobile, design
    _skill("Data Structures", "swe", "data structure"),
    _skill("Algorithms", "swe", "algorithm"),
    _skill("iOS", "mobile"),
    _skill("Android", "mobile"),
    _skill("Figma", "design"),
)