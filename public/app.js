// Same origin when served by the Worker; override locally with ?api=<url>.
const API = new URLSearchParams(location.search).get("api") ?? "/api/status";
const DAYS = 90;
document.getElementById("info").href = API;

const COMPONENTS = {
  site: { name: "Portfolio", url: "https://mgrzmil.dev" },
  app: { name: "App", url: "https://app.mgrzmil.dev" },
  api: { name: "API", url: "https://api.mgrzmil.dev/healthcheck" },
  cdn: { name: "Image CDN", url: "https://cdn.mgrzmil.dev" },
  e2e: { name: "End-to-end (API → image)" },
};

const LABEL = { up: "Operational", degraded: "Degraded", down: "Down" };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

function dayStatus(agg) {
  if (!agg) return "";
  if (agg.down > 0) return "down";
  if (agg.degraded > 0) return "degraded";
  return "up";
}

function uptime(days) {
  let ok = 0, total = 0;
  for (const d of Object.values(days)) {
    ok += d.up + d.degraded;
    total += d.up + d.degraded + d.down;
  }
  return total ? ((ok / total) * 100).toFixed(2) + "%" : "–";
}

function lastDays(n) {
  const keys = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) keys.push(new Date(now - i * 86400e3).toISOString().slice(0, 10));
  return keys;
}

function renderComponent(id, comp) {
  const meta = COMPONENTS[id] ?? { name: id };
  const { status, ms, err } = comp.current;

  const title = el("h3", {}, meta.name);
  if (meta.url) title.append(el("a", { href: meta.url }, new URL(meta.url).host));

  const bars = el("div", { class: "bars" });
  for (const key of lastDays(DAYS)) {
    const agg = comp.days[key];
    const tip = agg
      ? `${key}: ${agg.up} up, ${agg.degraded} degraded, ${agg.down} down, avg ${Math.round(agg.msSum / (agg.up + agg.degraded + agg.down))} ms`
      : `${key}: no data`;
    bars.append(el("span", { class: dayStatus(agg), title: tip }));
  }

  const card = el("div", { class: `component ${status}` },
    el("div", { class: "component-head" },
      title,
      el("span", { class: "pill" }, el("span", { class: `dot ${status}` }), ` ${LABEL[status]} · ${ms} ms`),
    ),
    bars,
    el("div", { class: "bars-legend" },
      el("span", {}, `${DAYS} days ago`),
      el("span", {}, `${uptime(comp.days)} uptime`),
      el("span", {}, "Today"),
    ),
  );
  if (err) card.append(el("p", { class: "err" }, err));
  return card;
}

function render(state) {
  const ids = Object.keys(COMPONENTS).filter((id) => state.components[id])
    .concat(Object.keys(state.components).filter((id) => !COMPONENTS[id]));
  const statuses = ids.map((id) => state.components[id].current.status);

  const overall = statuses.includes("down") ? "down" : statuses.includes("degraded") ? "degraded" : "up";
  const text = !ids.length ? "No data yet"
    : overall === "up" ? "All systems operational"
    : overall === "degraded" ? "Some systems degraded"
    : "Some systems are down";

  document.getElementById("overall-dot").className = `dot ${ids.length ? overall : ""}`;
  document.getElementById("overall-text").textContent = text;
  document.getElementById("updated").textContent = state.updated
    ? `Last checked ${new Date(state.updated).toLocaleString()}`
    : "";
  document.getElementById("components").replaceChildren(...ids.map((id) => renderComponent(id, state.components[id])));
}

async function load() {
  try {
    const res = await fetch(API, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(await res.json());
  } catch (e) {
    document.getElementById("overall-text").textContent = "Status unavailable";
    document.getElementById("updated").textContent = String(e.message ?? e);
  }
}

load();
setInterval(load, 60_000);
