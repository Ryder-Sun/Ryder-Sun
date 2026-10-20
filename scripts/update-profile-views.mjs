// Generates the "Profile Views" badge from this repository's real GitHub
// traffic data. The badge SVG is committed to the repo, so it is served by
// GitHub's own CDN and keeps rendering even when third-party counters
// (the previously used komarev.com) are down.

import { readFile, writeFile } from "node:fs/promises";

const OWNER = "Ryder-Sun";
const REPO = "Ryder-Sun";
const STATE_PATH = "scripts/profile-views-state.json";
const BADGE_PATH = "views-badge.svg";

// The previous third-party counter (komarev.com) showed 389 before it became
// unreliable. Seed the total with that value so the count continues from
// where it stopped instead of resetting to zero.
const BASELINE = 389;

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

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

async function fetchBadge(count) {
  const response = await fetch(
    `https://img.shields.io/badge/Profile_Views-${count}-0e75b6.svg?style=flat`,
  );

  if (!response.ok) {
    throw new Error(`shields.io failed: ${response.status} ${await response.text()}`);
  }

  return response.text();
}

const traffic = await fetchTrafficViews();
const state = mergeDays(await loadState(), traffic);
const count = totalViews(state);

await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
await writeFile(BADGE_PATH, await fetchBadge(count));

console.log(`profile views: ${count}`);
