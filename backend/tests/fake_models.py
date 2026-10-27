"""
Swap every model the API builds (app/services/models.py) for one fake, so a
test need not know which size a route asks for. A test of which size a
feature uses swaps one dependency itself (tests/test_model_sizes.py).
"""

from app.main import app
from app.services.models import get_large_llm, get_llm, get_small_llm

MODELS = (get_llm, get_large_llm, get_small_llm)


def use(fake) -> None:
    for model in MODELS:
        app.dependency_overrides[model] = lambda: fake


def clear() -> None:
    for model in MODELS:
        app.dependency_overrides.pop(model, None)
