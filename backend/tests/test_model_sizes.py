"""
Which model each AI feature asks for (KAN-356, app/services/models.py): the
large chain for writing and judgment, the small one for every keyword
extraction, the default for the rest. Read from each route's dependencies,
so no database or model is needed.
"""

import importlib

import pytest

from app.services.models import get_large_llm, get_llm, get_small_llm

SIZES = {get_llm: "default", get_large_llm: "large", get_small_llm: "small"}


def _sizes(module: str, name: str) -> set[str]:
    router = importlib.import_module(f"app.routers.{module}").router
    route = next(r for r in router.routes if r.name == name)
    found, stack = set(), [route.dependant]
    while stack:
        dependant = stack.pop()
        if dependant.call in SIZES:
            found.add(SIZES[dependant.call])
        stack.extend(dependant.dependencies)
    return found


@pytest.mark.parametrize(("module", "name", "sizes"), [
    ("scout", "chat", {"default"}),
    ("intake", "take_turn", {"default"}),
    ("essay_answer", "generate_essay_answer", {"default"}),
    # Tailor rewrites with the large chain but reads keywords with the small
    # one, so a posting's keywords come from one chain whoever reads first.
    ("tailor", "run", {"large", "small"}),
    ("bank", "import_resume", {"large"}),
    ("assistant", "ask", {"large"}),
    ("built_resumes", "keyword_match", {"small"}),
    ("company_jobs", "create_job", {"small"}),
    ("company_jobs", "update_job", {"small"}),
    ("company_jobs", "change_job_status", {"small"}),
])
def test_each_feature_asks_for_its_size(module, name, sizes):
    assert _sizes(module, name) == sizes
