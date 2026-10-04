// Pure logic: no Workers or Bun APIs, so it runs under both `bun test` and workerd.

export type Status = "up" | "degraded" | "down";

export interface CheckResult {
  status: Status;
  ms: number;
  err?: string;
}

export interface Sample extends CheckResult {
  t: number; // unix seconds
}

export interface DayAgg {
  up: number;
  degraded: number;
  down: number;
  msSum: number;
}

export interface ComponentState {
  current: Sample;
  recent: Sample[];
  days: Record<string, DayAgg>; // key: YYYY-MM-DD (UTC)
}

export interface State {
  updated: string;
  components: Record<string, ComponentState>;
}

export const RECENT_MAX = 288; // 24h at 5 min
export const DAYS_MAX = 90;

export function classify(ok: boolean, ms: number, degradedMs: number, err?: string): CheckResult {
  if (!ok) return { status: "down", ms, err: err || "check failed" };
  return { status: ms > degradedMs ? "degraded" : "up", ms };
}

// Maps anything thrown to a fixed public reason; raw messages can leak response
// bodies or internal paths, so they go to logs only. Never throws.
export function publicReason(e: unknown): string {
  try {
    const name = (e as { name?: unknown } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") return "timeout";
    if (name === "SyntaxError") return "invalid response";
    if (name === "TypeError") return "unreachable";
  } catch {}
  return "check failed";
}

export function emptyState(): State {
  return { updated: "", components: {} };
}

export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// Mutates and returns state. Ring buffers: oldest samples/days are evicted.
export function applyResults(state: State, results: Record<string, CheckResult>, now: Date): State {
  const t = Math.floor(now.getTime() / 1000);
  const today = dayKey(now);

  for (const [id, result] of Object.entries(results)) {
    const sample: Sample = { t, ...result };
    const comp = (state.components[id] ??= { current: sample, recent: [], days: {} });

    comp.current = sample;
    comp.recent.push(sample);
    if (comp.recent.length > RECENT_MAX) comp.recent.splice(0, comp.recent.length - RECENT_MAX);

    const day = (comp.days[today] ??= { up: 0, degraded: 0, down: 0, msSum: 0 });
    day[result.status]++;
    day.msSum += result.ms;
    for (const old of Object.keys(comp.days).sort().slice(0, -DAYS_MAX)) delete comp.days[old];
  }

  state.updated = now.toISOString();
  return state;
}
