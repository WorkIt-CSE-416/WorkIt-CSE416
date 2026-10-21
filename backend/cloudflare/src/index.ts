// The Worker in front of the API's Cloudflare Container (ADR 0004, KAN-295).
// It owns no logic: every request goes to one of INSTANCES containers running
// backend/Dockerfile. The rules are in backend/CLAUDE.md, Deployment.
import { Container, getRandom } from "@cloudflare/containers";

// Matches max_instances in wrangler.jsonc; getRandom never asks for more
const INSTANCES = 3;

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
  "AI_TAILOR_SHARE",
  "AI_INTAKE_SHARE",
  "AI_SCOUT_SHARE",
  "AI_PARSING_SHARE",
  "AI_ASSISTANT_SHARE",
] as const;

type Env = { API: DurableObjectNamespace<Api>; VERSION: WorkerVersionMetadata } & Partial<Record<(typeof FORWARDED)[number], string>>;

export class Api extends Container<Env> {
  defaultPort = 8080;
  // Memory is billed while awake; the first request after sleep waits for a
  // cold start (ADR 0004, Consequences)
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
  // container from any other version before serving.
  override async fetch(request: Request): Promise<Response> {
    const version = this.env.VERSION.id;
    if ((await this.ctx.storage.get<string>("version")) !== version) {
      if (this.ctx.container?.running) await this.destroy();
      await this.ctx.storage.put("version", version);
    }
    return super.fetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = await getRandom(env.API, INSTANCES);
    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
