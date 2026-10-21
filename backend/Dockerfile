# The API as one image, for the Cloudflare Container (ADR 0004, KAN-295).
# Build from the REPO ROOT, because ../scout is a path dependency:
#     docker build --platform linux/amd64 -f backend/Dockerfile -t workit-api .
# Every COPY names its paths, never a whole folder: `wrangler deploy` pipes
# this file in on stdin (`-f -`), so BuildKit never finds
# Dockerfile.dockerignore and a laptop's backend/.venv and vendor/ would land
# on top of the image's. backend/CLAUDE.md, Deployment, has the rules.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.19 /uv /usr/local/bin/uv

# pyproject.toml asks for a uv-managed interpreter (laptops); in the image the
# base's own 3.12 is the pinned one, so uv uses it instead of downloading one.
# Bytecode is compiled once here, not on every cold start.
ENV UV_PYTHON_PREFERENCE=only-system \
    UV_PYTHON=/usr/local/bin/python3.12 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

RUN useradd --create-home --uid 1000 api
WORKDIR /app/backend

# Dependencies first, so a code-only change reuses this layer
COPY scout/pyproject.toml /app/scout/
COPY scout/workit_scout /app/scout/workit_scout
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/data ./data
COPY backend/scripts ./scripts
COPY backend/app ./app
# Pinned Tectonic and its warm cache into vendor/tectonic/. Owned by the
# runtime user: Tectonic writes into its cache even offline, so a writable
# cache is used in place (no copy to /tmp)
RUN .venv/bin/python scripts/fetch_tectonic.py && chown -R api:api vendor

USER api
EXPOSE 8080
CMD [".venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "*"]
