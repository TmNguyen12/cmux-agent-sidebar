import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSidebar, ws, agent } from "./harness.mjs";

const SOURCE = readFileSync(fileURLToPath(new URL("../sidebars/agents.js", import.meta.url)), "utf8");
const ALLOWED_VERBS = ["surface.focus", "workspace.select"];

const sb = loadSidebar();

test("fmtElapsed pads minutes and seconds", () => {
  assert.equal(sb.fmtElapsed(45), "45s");
  assert.equal(sb.fmtElapsed(245), "4m 05s");
  assert.equal(sb.fmtElapsed(3720), "1h 02m");
});

test("fmtAgo uses the largest whole unit", () => {
  assert.equal(sb.fmtAgo(30), "30s");
  assert.equal(sb.fmtAgo(720), "12m");
  assert.equal(sb.fmtAgo(7200), "2h");
  assert.equal(sb.fmtAgo(2 * 86400 + 5), "2d");
});

// Every row kind and status, an agent without a surfaceId, subagents, and a
// workspace with no folder, so every row builder and tap handler is reached.
const fixture = [
  ws("w1", {
    directory: "/r/worktrees/app/main", branch: "main", selected: true,
    tabs: [{ id: "p1", title: "api server" }],
    agents: [
      agent("a1", "working", {
        sinceEpoch: 900, surfaceId: "s1", panelId: "p1",
        children: [
          { id: "c1", running: true, startedEpoch: 950, label: "explore" },
          { id: "c2", running: false, startedEpoch: 900, endedEpoch: 940 },
        ],
      }),
      agent("a2", "needs_input", { surfaceId: "s2" }),
      agent("a3", "idle"),
      agent("a4", "ended", { lastActivityAt: 990 }),
    ],
  }),
  ws("w2", { title: "scratch" }),
];

test("render builds every row without throwing", () => {
  const ctx = loadSidebar({ workspaces: fixture, epoch: 1000, time: "12:00:00" });
  assert.equal(typeof ctx.__render, "function");
  assert.doesNotThrow(() => ctx.__render());
});

test("loading and rendering make no cmux calls without a click", () => {
  const ctx = loadSidebar({ workspaces: fixture, epoch: 1000 });
  ctx.__render();
  assert.equal(ctx.__cmuxCalls.length, 0);
  assert.ok(ctx.__taps.length > 0);
});

test("tapping rows selects workspaces and focuses agent terminals", () => {
  const ctx = loadSidebar({ workspaces: fixture, epoch: 1000 });
  ctx.__render();
  for (const tap of ctx.__taps) tap();
  const calls = JSON.parse(JSON.stringify(ctx.__cmuxCalls));
  assert.ok(calls.some((c) => c.method === "workspace.select" && c.params.workspace_id === "w2"));
  assert.ok(calls.some((c) => c.method === "surface.focus" && c.params.surface_id === "s1"));
  assert.ok(calls.some((c) => c.method === "surface.focus" && c.params.surface_id === "s2"));
});

test("every tap only calls workspace.select and surface.focus", () => {
  const ctx = loadSidebar({ workspaces: fixture, epoch: 1000 });
  ctx.__render();
  for (const tap of ctx.__taps) tap();
  const methods = new Set(ctx.__cmuxCalls.map((c) => c.method));
  assert.deepEqual([...methods].sort(), ALLOWED_VERBS);
});

test("the source names only allowed cmux verbs and no risky APIs", () => {
  const verbs = [...SOURCE.matchAll(/cmux\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(verbs.length > 0);
  for (const v of verbs) assert.ok(ALLOWED_VERBS.includes(v), `unexpected cmux verb ${v}`);
  assert.equal(SOURCE.match(/cmux\(/g).length, verbs.length, "cmux() called with a non-literal verb");
  for (const api of ["openURL", "clipboard", "TextField", "fetch(", "log("]) {
    assert.ok(!SOURCE.includes(api), `sidebar must not use ${api}`);
  }
});

test("render handles a capped row list and many subagents", () => {
  const children = Array.from({ length: 8 }, (_, i) => ({ id: "c" + i, running: true, startedEpoch: i }));
  const many = Array.from({ length: 300 }, (_, i) => ws("w" + i, { directory: "/r/repo" + i }));
  many[0].agents = [agent("a1", "working", { children })];
  const ctx = loadSidebar({ workspaces: many, epoch: 1000 });
  assert.doesNotThrow(() => ctx.__render());
});

test("agentTime says ago for done agents and ticks elapsed for running ones", () => {
  assert.equal(sb.agentTime({ status: "idle", lastActivityAt: 880 }, 1000), "2m ago");
  assert.equal(sb.agentTime({ status: "working", sinceEpoch: 880 }, 1000), "2m 00s");
  assert.equal(sb.agentTime({ status: "needs_input", sinceEpoch: 970 }, 1000), "30s");
});

test("toCards nests each group's agents under it and keeps the more row", () => {
  const rows = [
    { key: "g:/a", kind: "group" }, { key: "a:1", kind: "agent" }, { key: "a:2", kind: "agent" },
    { key: "g:/b", kind: "group" },
    { key: "m:rows", kind: "more" },
  ];
  const cards = JSON.parse(JSON.stringify(sb.toCards(rows)));
  assert.deepEqual(cards.map((c) => [c.key, c.kind, (c.agents ?? []).map((a) => a.key)]), [
    ["g:/a", "card", ["a:1", "a:2"]],
    ["d:g:/b", "divider", []],
    ["g:/b", "card", []],
    ["m:rows", "more", []],
  ]);
});

test("toCards keeps repo rows and gives nested groups their own card kind and key", () => {
  const rows = [
    { key: "r:/r/app", kind: "repo", label: "app" },
    { key: "g:/r/app", kind: "group", nested: true }, { key: "a:1", kind: "agent" },
    { key: "g:/docs", kind: "group", nested: false },
  ];
  const cards = JSON.parse(JSON.stringify(sb.toCards(rows)));
  assert.deepEqual(cards.map((c) => [c.key, c.kind, (c.agents ?? []).map((a) => a.key)]), [
    ["r:/r/app", "repo", []],
    ["n:g:/r/app", "nestedCard", ["a:1"]],
    ["d:g:/docs", "divider", []],
    ["g:/docs", "card", []],
  ]);
});

test("toCards puts a divider between top-level sections, not before the first or the more row", () => {
  const rows = [
    { key: "g:/a", kind: "group" },
    { key: "r:/r/app", kind: "repo", label: "app" },
    { key: "g:/r/app", kind: "group", nested: true },
    { key: "g:/r/worktrees/app/x", kind: "group", nested: true },
    { key: "m:rows", kind: "more" },
  ];
  const cards = JSON.parse(JSON.stringify(sb.toCards(rows)));
  assert.deepEqual(cards.map((c) => c.key), [
    "g:/a", "d:r:/r/app", "r:/r/app", "n:g:/r/app", "n:g:/r/worktrees/app/x", "m:rows",
  ]);
});
