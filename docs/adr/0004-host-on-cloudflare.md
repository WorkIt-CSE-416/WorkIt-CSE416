# Both halves host on Cloudflare Workers Paid, the API in a Container

The app runs on Cloudflare Workers through the OpenNext adapter, and the API runs as a Docker image in a Cloudflare Container behind a small Worker, both on the Workers Paid plan ($5 a month) at `workitjobs.ai` and `api.workitjobs.ai`. This reverses KAN-146's choice of Vercel: Vercel Hobby forbids commercial use and has no team members, and Pro costs $20 per member per month. Cloudflare allows commercial use on every plan and adds account members at no cost (KAN-169).

## Considered Options

- **Workers Free for the app**: rejected because it allows 10 ms of CPU per request, which a Next 16 server render often exceeds (error 1102).
- **Python Workers for the API**: rejected because they run on Pyodide, which cannot run the Tectonic binary (ADR 0002) and lacks wheels for some native packages. Containers are the only Cloudflare product that runs the API unchanged, and they need Workers Paid.
- **Cloud Run for the API, Workers Free for the app**: free, and Cloud Run runs a Dockerfile, but it keeps the CPU risk and splits the team across two accounts. KAN-146 called Cloud Run "no usable free tier"; in fact the free tier only needs a card on file.
- **Render**: the free tier sleeps and takes about a minute to wake, which made sign-in look broken (KAN-146).

## Consequences

- A sleeping API container makes the next request wait 6–13 s while it starts. A cron pings each of the two instances every 5 minutes, so none sleeps. Memory and disk are billed while a container is awake, so this costs about $15 a month (`backend/CLAUDE.md`, Deployment).
- OpenNext does not support Node middleware yet. If it rejects Next 16's `proxy.ts`, the file goes back to `middleware.ts` on the Edge runtime.
- `NEXT_PUBLIC_*` variables are inlined at build time, so they are Workers Builds build variables, not runtime secrets.
- Request bodies may reach 100 MB, which ends Vercel's 4.5 MB cap below the 5 MB upload limit.
