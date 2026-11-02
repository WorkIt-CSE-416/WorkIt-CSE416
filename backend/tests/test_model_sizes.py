"""
Which model each AI feature asks for (KAN-356, app/services/models.py): the
large chain for writing and judgment, the small one for every keyword
extraction, the default for the rest. Read from each route's dependencies,
so no database or model is needed.
"""

import importlib
import pkgutil

import pytest

from app.services.models import get_large_llm, get_llm, get_small_llm

SIZES = {get_llm: "default", get_large_llm: "large", get_small_llm: "small"}


def _sizes(module: str, name: str) -> set[str]:
    router = importlib.import_module(f"app.routers.{module}").router
    return _route_sizes(next(r for r in router.routes if r.name == name))


def _route_sizes(route) -> set[str]:
    found, stack = set(), [route.dependant]
    while stack:
        dependant = stack.pop()
        if dependant.call in SIZES:
            found.add(SIZES[dependant.call])
        stack.extend(dependant.dependencies)
    return found


FEATURES = [
    ("scout", "chat", {"default"}),
    ("intake", "take_turn", {"default"}),
    # Tailor rewrites with the large chain but reads keywords with the small
    # one, so a posting's keywords come from one chain whoever reads first.
    ("tailor", "run", {"large", "small"}),
    ("tailor", "run_streamed", {"large", "small"}),
    ("tailor", "match", {"small"}),
    ("bank", "import_resume", {"large"}),
    ("assistant", "ask", {"large"}),
    ("built_resumes", "keyword_match", {"small"}),
    ("company_jobs", "create_job", {"small"}),
    ("company_jobs", "update_job", {"small"}),
    ("company_jobs", "change_job_status", {"small"}),
]


@pytest.mark.parametrize(("module", "name", "sizes"), FEATURES)
def test_each_feature_asks_for_its_size(module, name, sizes):
    assert _sizes(module, name) == sizes


def test_only_the_listed_features_ask_for_a_model():
    """Every route that asks for a model is one of FEATURES. The autofiller's
    fill calls none (KAN-470): an essay comes from the student's own Claude
    through the connector, or their paste on Written Answers."""
    import app.routers

    asking = set()
    for found in pkgutil.iter_modules(app.routers.__path__):
        router = getattr(importlib.import_module(f"app.routers.{found.name}"), "router", None)
        for route in getattr(router, "routes", []):
            if hasattr(route, "dependant") and _route_sizes(route):
                asking.add((found.name, route.name))
    assert asking == {(module, name) for module, name, _ in FEATURES}
