// The Worker in front of the API's Cloudflare Container (ADR 0004, KAN-295).
// It owns no logic: every request goes to one of INSTANCES containers running
// backend/Dockerfile. The rules are in backend/CLAUDE.md, Deployment.
import { Container } from "@cloudflare/containers";

// Half of max_instances in wrangler.jsonc, which leaves room for a rename.
// The cron (scheduled, below) keeps every one of them awake.
const INSTANCES = 2;

// Every name the API or Scout reads from the environment (app/config.py,
// ../scout/workit_scout/settings.py). Set as Worker secrets by CI, plus
// wrangler.jsonc's vars. A name the Worker lacks is not forwarded, so the
// container falls back to the code's default, as on a laptop without it.
// SCOUT_DAILY_TURNS is ignored since KAN-210; forwarded only because CI
// still sets it.
const FORWARDED = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "SCOUT_ENDPOINTS",
  "SCOUT_BASE_URL",
  "SCOUT_MODEL",
  "SCOUT_API_KEY",
  "SCOUT_REASONING_EFFORT",
  "SCOUT_DAILY_TURNS",
  "EMBEDDING_PROVIDER",
  "GEMINI_API_KEY",
  "AI_DAILY_POOL",
  "AI_SCOUT_CAP",
  "AI_INTAKE_CAP",
  "AI_TAILOR_CAP",
  "AI_PARSING_CAP",
  "AI_ASSISTANT_CAP",
  "AI_ESSAY_CAP",
  "AI_TAILOR_SHARE",
  "AI_INTAKE_SHARE",
  "AI_SCOUT_SHARE",
  "AI_PARSING_SHARE",
  "AI_ASSISTANT_SHARE",
  "AI_ESSAY_SHARE",
] as const;

type Env = { API: DurableObjectNamespace<Api>; VERSION: WorkerVersionMetadata } & Partial<Record<(typeof FORWARDED)[number], string>>;

export class Api extends Container<Env> {
  defaultPort = 8080;
  // Longer than the cron's interval (wrangler.jsonc), so the pings keep each
  // instance awake. An instance the Worker no longer routes to (after
  // INSTANCES shrinks) sleeps this long after its last request.
  sleepAfter = "10m";

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    const vars: Record<string, string> = {};
    for (const name of FORWARDED) {
      const value = env[name];
      if (value !== undefined && value !== "") vars[name] = value;
    }
    this.envVars = vars;
  }

  // A container keeps the environment it started with, and an Api object
  // that finds its container still running attaches to it as it is. So
  // after a deploy or a secret change, one instance answered with a stale
  // [SENSITIVE] setting for every third request (2026-10-21). Each object
  // records the Worker version its container started under and replaces a
  // container from any other version before serving. The replacement runs
  // inside blockConcurrencyWhile: destroy() is not a storage call, so without
  // it a second request could read the old version while the first waited,
  // and destroy the container again or start one mid-teardown.
  override async fetch(request: Request): Promise<Response> {
    const version = this.env.VERSION.id;
    if ((await this.ctx.storage.get<string>("version")) !== version) {
      await this.ctx.blockConcurrencyWhile(async () => {
        if ((await this.ctx.storage.get<string>("version")) === version) return;
        if (this.ctx.container?.running) await this.destroy();
        await this.ctx.storage.put("version", version);
      });
    }
    return super.fetch(request);
  }
}

// A location hint, so each object sits near its container, which
// wrangler.jsonc's constraints keep in eastern North America. A hint places
// an object only when it is first made, hence the "enam-N" names (2026-10-21).
function instance(env: Env, n: number) {
  return env.API.get(env.API.idFromName(`enam-${n}`), { locationHint: "enam" });
}

export default {
  // As the library's getRandom: the API is stateless, so any instance serves
  // any request
  async fetch(request: Request, env: Env): Promise<Response> {
    return instance(env, Math.floor(Math.random() * INSTANCES)).fetch(request);
  },

  // The cron in wrangler.jsonc. A cold container made the next request wait
  // 6-13 s (2026-10-22), so each instance gets a GET /health (no database)
  // more often than sleepAfter, and never sleeps. After a deploy, the first
  // ping also swaps in the new version's container, so no user waits for it.
  // A failed ping is logged and left: the next one tries again.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const pings = Array.from({ length: INSTANCES }, (_, n) =>
      instance(env, n).fetch("https://api.workitjobs.ai/health"),
    );
    ctx.waitUntil(
      Promise.allSettled(pings).then((results) =>
        results.forEach((r, n) => {
          if (r.status === "rejected") console.error(`enam-${n} ping failed`, r.reason);
          else if (!r.value.ok) console.error(`enam-${n} ping answered ${r.value.status}`);
        }),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
