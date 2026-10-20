// Keeps the "Profile Views" badge on the profile README working.
//
// Primary display: komarev.com real-time badge (user preference).
// Fallback: views-badge.svg generated from this repo's real GitHub traffic
// data (baseline 389 carried over from the komarev counter), committed by
// this workflow so it is served by GitHub's own CDN.
//
// Every run:
//   1. refresh the traffic state and render the fallback badge
//   2. probe komarev with a dummy username (probing the real badge URL
//      would inflate the counter on every health check)
//   3. point both READMEs at komarev when it is healthy, or at the local
//      fallback badge when komarev is down — the profile never shows a
//      broken image for long, and switches back automatically on recovery

import { readFile, writeFile } from "node:fs/promises";

const OWNER = "Ryder-Sun";
const REPO = "Ryder-Sun";
const STATE_PATH = "scripts/profile-views-state.json";
const BADGE_PATH = "views-badge.svg";
const READMES = ["README.md", "README.zh.md"];

const KOMAREV_BADGE_URL = "https://komarev.com/ghpvc/?username=Ryder-Sun&label=Profile%20Views&color=0e75b6&style=flat";
const KOMAREV_PROBE_URL = "https://komarev.com/ghpvc/?username=komarev-healthcheck-probe&style=flat";
const FALLBACK_BADGE_URL = "./views-badge.svg";

// The komarev counter showed 389 before it became unreliable. Seed the
// fallback total with that value so the count continues instead of
// resetting to zero.
const BASELINE = 389;

// The traffic API rejects the default GITHUB_TOKEN ("Resource not accessible
// by integration"), so a PAT must be provided via the PROFILE_VIEWS_TOKEN env.
const token = process.env.PROFILE_VIEWS_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

async function fetchTrafficViews() {
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/traffic/views`,
    { headers },
  );

  if (!response.ok) {
    throw new Error(`GitHub traffic API failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch {
    return { baseline: BASELINE, days: {} };
  }
}

function mergeDays(state, traffic) {
  for (const { timestamp, count } of traffic.views) {
    const day = timestamp.slice(0, 10);

    // The traffic API only returns the last 14 days, and today's entry keeps
    // growing until the day ends, so keep the highest value seen per day.
    state.days[day] = Math.max(state.days[day] || 0, count);
  }

  return state;
}

function totalViews(state) {
  const daysTotal = Object.values(state.days).reduce((sum, count) => sum + count, 0);
  return state.baseline + daysTotal;
}

// Widths are pre-computed for the fixed label "Profile Views" (left cell
// width 81) and per-digit counts, matching shields.io flat badge geometry
// exactly (verified byte-identical against img.shields.io output).
function renderBadge(count) {
  const digits = String(count).length;
  const rightWidth = 7 * digits + 10;
  const totalWidth = 81 + rightWidth;
  const rightCenter = 81 + rightWidth / 2 - 1;
  const numberWidth = 70 * digits;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="Profile Views: ${count}"><title>Profile Views: ${count}</title><filter id="blur"><feGaussianBlur stdDeviation="16"/></filter><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${totalWidth}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="81" height="20" fill="#555"/><rect x="81" width="${rightWidth}" height="20" fill="#0e75b6"/><rect width="${totalWidth}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110"><g transform="scale(.1)"><g aria-hidden="true" fill="#010101"><text x="415" y="150" fill-opacity=".8" filter="url(#blur)" textLength="710">Profile Views</text><text x="415" y="150" fill-opacity=".3" textLength="710">Profile Views</text></g><text x="415" y="140" textLength="710">Profile Views</text></g><g transform="scale(.1)"><g aria-hidden="true" fill="#010101"><text x="${rightCenter * 10}" y="150" fill-opacity=".8" filter="url(#blur)" textLength="${numberWidth}">${count}</text><text x="${rightCenter * 10}" y="150" fill-opacity=".3" textLength="${numberWidth}">${count}</text></g><text x="${rightCenter * 10}" y="140" textLength="${numberWidth}">${count}</text></g></g></svg>`;
}

async function isKomarevHealthy() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(KOMAREV_PROBE_URL, {
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "profile-views-badge-healthcheck" },
      });

      if (response.ok && (await response.text()).includes("<svg")) {
        return true;
      }
    } catch {
      // retry on next attempt
    }
  }

  return false;
}

async function updateReadmeBadgeSrc(src) {
  const pattern = /(<img\s+src=")[^"]*("\s+alt="Profile views"\s*\/>)/;

  for (const path of READMES) {
    const content = await readFile(path, "utf8");
    const updated = content.replace(pattern, `$1${src}$2`);

    if (updated === content) {
      if (!content.includes(`src="${src}"`)) {
        throw new Error(`Profile views img tag not found in ${path}`);
      }

      continue;
    }

    await writeFile(path, updated);
  }
}

const traffic = await fetchTrafficViews();
const state = mergeDays(await loadState(), traffic);
const count = totalViews(state);

await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
await writeFile(BADGE_PATH, renderBadge(count));

const healthy = await isKomarevHealthy();
await updateReadmeBadgeSrc(healthy ? KOMAREV_BADGE_URL : FALLBACK_BADGE_URL);

console.log(`profile views (fallback badge): ${count}`);
console.log(`komarev: ${healthy ? "healthy — READMEs point at komarev" : "DOWN — READMEs point at local fallback badge"}`);
