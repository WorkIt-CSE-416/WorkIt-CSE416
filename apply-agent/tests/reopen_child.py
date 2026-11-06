"""The Apply process that `test_reopen` kills: it rehearses two fake Greenhouse forms in one plain Worker, the second
held open for Lisul, and keeps both on the open-forms list. Run as a script by the test, never by pytest.

argv: profiles folder, the fake's HTTPS port, the open-forms list, the Records folder, the Applicant profile."""

import shutil
import sys
from pathlib import Path

from conftest import ARC_FORM, ARC_URL, FIXTURES, PURE_STORAGE_FORM, PURE_STORAGE_URL
from fakes import FakeJobServer
from test_rehearse import NeverSubmits, adapters

from apply import batch, cover_letter, home, rehearsal
from apply.fillers import FILLERS
from apply.greenhouse import GreenhouseFiller
from apply.plain.bridge import Bridge
from apply.plain.launcher import PlainWorkers
from apply.plain.site import PlainSite
from apply.profile import ApplicantProfile
from apply.records import FolderRecords

folder, port, listed, records, profile = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4]), sys.argv[5]
batch.PATH = listed
# As conftest's fixtures give each test: the Test Person data and the tests' Story bank, and cover letters as text.
shutil.copytree(home.SAMPLE, home.HOME, dirs_exist_ok=True)
shutil.copy(FIXTURES / "story-bank.md", home.STORY_BANK)
cover_letter.pdf = lambda text, posting, profile, path, today=None: path.write_text(text)
FILLERS["greenhouse"] = NeverSubmits(GreenhouseFiller())
flags = (f"--host-resolver-rules=MAP * 127.0.0.1:{port}", "--ignore-certificate-errors", "--disable-quic")
site = PlainSite(PlainWorkers(folder, kind="testing", bridge=Bridge(folder / "w.sock"), test_flags=flags))
with FakeJobServer(ARC_FORM, PURE_STORAGE_FORM) as fetcher:  # the postings' text only: the pages come from the test's fake
    site.fetch = fetcher.fetch
    loaded = ApplicantProfile.load(Path(profile))
    rehearsal.rehearse([ARC_URL], adapters(site, records=FolderRecords(records)), loaded, keep_open=False, out=print)
    # The second form is held for Lisul in the same Worker when the test kills this process.
    rehearsal.rehearse([PURE_STORAGE_URL], adapters(site, records=FolderRecords(records)), loaded, out=print)
