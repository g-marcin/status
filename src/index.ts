import { applyResults, classify, emptyState, errorMessage, type CheckResult, type State } from "./lib";

const STATE_KEY = "state";
const TIMEOUT_MS = 8000;

interface Check {
  id: string;
  run: () => Promise<CheckResult>;
}

// A probe returns an error message, or undefined when healthy.
type Probe = () => Promise<string | undefined>;

function check(id: string, degradedMs: number, probe: Probe): Check {
  return {
    id,
    run: async () => {
      const start = Date.now();
      let err: string | undefined;
      try {
        err = await probe();
      } catch (e) {
        err = errorMessage(e);
      }
      return classify(err === undefined, Date.now() - start, degradedMs, err);
    },
  };
}

function get(url: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": "mgrzmil-status/1.0" },
    cf: { cacheTtl: 0 },
  });
}

function httpCheck(
  id: string,
  url: string,
  degradedMs: number,
  validate?: (res: Response) => Promise<string | undefined>,
): Check {
  return check(id, degradedMs, async () => {
    const res = await get(url);
    if (!res.ok) return `HTTP ${res.status}`;
    if (validate) return validate(res);
    await res.body?.cancel();
    return undefined;
  });
}

function buildChecks(env: Env): Check[] {
  return [
    httpCheck("site", env.SITE_URL, 2000),
    httpCheck("app", env.APP_URL, 2000),
    httpCheck("api", `${env.API_URL}/healthcheck`, 1500, async (res) => {
      const body = await res.json<{ status?: string }>();
      return body.status === "success" ? undefined : `status=${body.status}`;
    }),
    httpCheck("cdn", `${env.CDN_URL}/health`, 1500, async (res) => {
      const body = await res.json<{ assets_exists?: boolean }>();
      return body.assets_exists ? undefined : "assets dir missing";
    }),
    // End-to-end: API returns an image URL, and that image actually loads.
    check("e2e", 3000, async () => {
      const apiRes = await get(`${env.API_URL}/breeds/image/random`);
      if (!apiRes.ok) return `api HTTP ${apiRes.status}`;
      const { message: imageUrl } = await apiRes.json<{ message?: string }>();
      if (!imageUrl) return "api returned no image url";

      const img = await get(imageUrl);
      await img.body?.cancel();
      if (!img.ok) return `image HTTP ${img.status}`;
      if (!img.headers.get("content-type")?.startsWith("image/")) return "not an image";
      return undefined;
    }),
  ];
}

async function runChecks(env: Env): Promise<State> {
  const checks = buildChecks(env);
  // One failing check must not drop the whole run's sample.
  const entries = await Promise.all(
    checks.map(async (c): Promise<[string, CheckResult]> => {
      try {
        return [c.id, await c.run()];
      } catch (e) {
        return [c.id, { status: "down", ms: 0, err: errorMessage(e) }];
      }
    }),
  );
  const results = Object.fromEntries(entries);

  const state = (await env.STATUS.get<State>(STATE_KEY, "json")) ?? emptyState();
  applyResults(state, results, new Date());
  await env.STATUS.put(STATE_KEY, JSON.stringify(state)); // single write per run (free tier: 1000/day)
  return state;
}

export default {
  scheduled(_controller, env, ctx) {
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
