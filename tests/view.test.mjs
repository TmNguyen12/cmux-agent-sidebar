import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSidebar, ws, agent } from "./harness.mjs";

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

const fixture = [
  ws("w1", {
    directory: "/r/worktrees/app/main", branch: "main", selected: true,
    agents: [agent("a1", "working", { sinceEpoch: 900, surfaceId: "s1" })],
  }),
  ws("w2", { title: "scratch" }),
];

test("render builds every row without throwing", () => {
  const ctx = loadSidebar({ workspaces: fixture, epoch: 1000, time: "12:00:00" });
  assert.equal(typeof ctx.__render, "function");
  assert.doesNotThrow(() => ctx.__render());
});

test("tapping a worktree selects its workspace and tapping an agent focuses its terminal", () => {
  const ctx = loadSidebar({ workspaces: fixture, epoch: 1000 });
  ctx.__render();
  const calls = JSON.parse(JSON.stringify(ctx.__cmuxCalls));
  assert.ok(calls.some((c) => c.method === "workspace.select" && c.params.workspace_id === "w2"));
  assert.ok(calls.some((c) => c.method === "surface.focus" && c.params.surface_id === "s1"));
});

test("the sidebar only calls workspace.select and surface.focus", () => {
  const ctx = loadSidebar({ workspaces: fixture, epoch: 1000 });
  ctx.__render();
  const methods = new Set(ctx.__cmuxCalls.map((c) => c.method));
  assert.deepEqual([...methods].sort(), ["surface.focus", "workspace.select"]);
});
