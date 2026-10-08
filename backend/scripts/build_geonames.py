"""
Build data/places.tsv, the gazetteer app/services/location_resolver.py reads,
from three GeoNames dumps:

    cities15000.zip       every city of 15,000+ people, with alternate names
    countryInfo.txt       countries: ISO2, ISO3, name
    admin1CodesASCII.txt  first-level subdivisions worldwide (states, provinces)

    uv run python scripts/build_geonames.py               download, then build
    uv run python scripts/build_geonames.py --src DIR     build from files in DIR

Re-run it to refresh the data; the output is committed so a build is
reproducible and the import never downloads anything. Stdlib only.

GeoNames is CC BY 4.0: the attribution line written at the top of the output
must stay there.
"""

import argparse
import datetime
import io
import re
import tempfile
import unicodedata
import urllib.request
import zipfile
from pathlib import Path

BASE_URL = "https://download.geonames.org/export/dump/"
FILES = ("cities15000.zip", "countryInfo.txt", "admin1CodesASCII.txt")
OUT = Path(__file__).resolve().parents[1] / "data" / "places.tsv"

# An alternate name is kept only if, accent-folded, it is plain Latin letters:
# the resolver reads English-language job boards, and the other scripts and
# transliterations GeoNames carries would triple the file for no match.
_KEEP_ALT = re.compile(r"[a-z][a-z .'\-]{1,39}")


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def _download(dest: Path) -> None:
    for name in FILES:
        with urllib.request.urlopen(BASE_URL + name, timeout=60) as resp:
            (dest / name).write_bytes(resp.read())


def _clean(field: str) -> str:
    # Tabs and pipes are this file's separators; GeoNames uses neither in names,
    # but a stray one would shift every column after it.
    return field.replace("\t", " ").replace("|", " ").strip()


def build(src: Path, out: Path) -> None:
    built = datetime.datetime.now(datetime.UTC).date().isoformat()
    lines = [
        "# Derived from GeoNames (https://www.geonames.org), licensed CC BY 4.0.",
        f"# Built by scripts/build_geonames.py on {built} from cities15000, countryInfo and admin1CodesASCII.",
        "# country<TAB>ISO2<TAB>ISO3<TAB>name",
        "# region<TAB>ISO2<TAB>admin1 code<TAB>name<TAB>ascii name",
        "# city<TAB>ISO2<TAB>admin1 code<TAB>population<TAB>name<TAB>ascii name<TAB>alternates, |-separated",
    ]

    for row in (src / "countryInfo.txt").read_text(encoding="utf-8").splitlines():
        if not row or row.startswith("#"):
            continue
        cols = row.split("\t")
        lines.append("\t".join(["country", cols[0], cols[1], _clean(cols[4])]))

    for row in (src / "admin1CodesASCII.txt").read_text(encoding="utf-8").splitlines():
        if not row:
            continue
        code, name, ascii_name, _geonameid = row.split("\t")
        country, admin1 = code.split(".", 1)
        lines.append("\t".join(["region", country, admin1, _clean(name), _clean(ascii_name)]))

    with zipfile.ZipFile(src / "cities15000.zip") as zf:
        text = io.TextIOWrapper(zf.open("cities15000.txt"), encoding="utf-8")
        for row in text:
            cols = row.rstrip("\n").split("\t")
            name, ascii_name, alternates = cols[1], cols[2], cols[3]
            country, admin1, population = cols[8], cols[10], cols[14]
            own = {_fold(name), _fold(ascii_name)}
            kept = []
            for alt in alternates.split(","):
                folded = _fold(alt.strip())
                if folded not in own and _KEEP_ALT.fullmatch(folded):
                    own.add(folded)
                    kept.append(_clean(alt))
            lines.append("\t".join([
                "city", country, admin1, population or "0",
                _clean(name), _clean(ascii_name), "|".join(kept),
            ]))

    out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--src", type=Path, help="folder holding the GeoNames files; downloads them if omitted")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    if args.src:
        build(args.src, args.out)
    else:
        with tempfile.TemporaryDirectory() as tmp:
            _download(Path(tmp))
            build(Path(tmp), args.out)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
