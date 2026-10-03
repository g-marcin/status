import { applyResults, classify, emptyState, type CheckResult, type State } from "./lib";

const STATE_KEY = "state";
const TIMEOUT_MS = 8000;

interface Check {
  id: string;
  run: () => Promise<CheckResult>;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; ms: number; err?: string }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { value, ms: Date.now() - start };
  } catch (e) {
    return { ms: Date.now() - start, err: e instanceof Error ? e.message : String(e) };
  }
}

function get(url: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": "mgrzmil-status/1.0" },
    cf: { cacheTtl: 0 },
  });
}

// validate returns an error message, or undefined when the response is healthy
function httpCheck(
  id: string,
  url: string,
  degradedMs: number,
  validate?: (res: Response) => Promise<string | undefined>,
): Check {
  return {
    id,
    run: async () => {
      const r = await timed(async () => {
        const res = await get(url);
        if (!res.ok) return `HTTP ${res.status}`;
        return validate ? await validate(res) : (await res.body?.cancel(), undefined);
      });
      const err = r.err ?? r.value;
      return classify(!err, r.ms, degradedMs, err);
    },
  };
}

const checks: Check[] = [
  httpCheck("site", "https://mgrzmil.dev/", 2000),
  httpCheck("app", "https://app.mgrzmil.dev/", 2000),
  httpCheck("api", "https://api.mgrzmil.dev/healthcheck", 1500, async (res) => {
    const body = await res.json<{ status?: string }>();
    return body.status === "success" ? undefined : `status=${body.status}`;
  }),
  httpCheck("cdn", "https://cdn.mgrzmil.dev/health", 1500, async (res) => {
    const body = await res.json<{ assets_exists?: boolean }>();
    return body.assets_exists ? undefined : "assets dir missing";
  }),
  {
    id: "e2e",
    run: async () => {
      const r = await timed(async () => {
        const apiRes = await get("https://api.mgrzmil.dev/breeds/image/random");
        if (!apiRes.ok) return `api HTTP ${apiRes.status}`;
        const { message } = await apiRes.json<{ message?: string }>();
        if (!message) return "api returned no image url";
        const img = await get(message);
        await img.body?.cancel();
        if (!img.ok) return `image HTTP ${img.status}`;
        if (!img.headers.get("content-type")?.startsWith("image/")) return "not an image";
        return undefined;
      });
      const err = r.err ?? r.value;
      return classify(!err, r.ms, 3000, err);
    },
  },
];

async function runChecks(env: Env): Promise<State> {
  const settled = await Promise.allSettled(checks.map((c) => c.run()));
  const results: Record<string, CheckResult> = {};
  checks.forEach((c, i) => {
    const s = settled[i]!;
    results[c.id] = s.status === "fulfilled" ? s.value : { status: "down", ms: 0, err: String(s.reason) };
  });

  const state = (await env.STATUS.get<State>(STATE_KEY, "json")) ?? emptyState();
  applyResults(state, results, new Date());
  await env.STATUS.put(STATE_KEY, JSON.stringify(state)); // single write per run (free tier: 1000/day)
  return state;
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runChecks(env));
  },

  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

    if (pathname === "/api/status") {
      const state = (await env.STATUS.get(STATE_KEY)) ?? JSON.stringify(emptyState());
      return new Response(state, {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=60",
          "access-control-allow-origin": "*",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
