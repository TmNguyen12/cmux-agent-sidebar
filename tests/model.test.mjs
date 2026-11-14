import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSidebar, ws, agent } from "./harness.mjs";

const EPOCH = 1000;
const sb = loadSidebar();
// The sidebar runs in its own vm realm; copy rows into this realm so
// deepStrictEqual compares values, not Array prototypes.
const rows = (workspaces, epoch = EPOCH) => JSON.parse(JSON.stringify(sb.buildRows(workspaces, epoch)));
const keys = (workspaces, epoch) => rows(workspaces, epoch).map((r) => r.key);

test("repoOf takes the segment after worktrees/", () => {
  assert.equal(sb.repoOf("/Users/t/Work/worktrees/bluebird/feat/x"), "bluebird");
});

test("repoOf falls back to the last path segment, ignoring a trailing slash", () => {
  assert.equal(sb.repoOf("/Users/t/Repos/cmux-agent-sidebar/"), "cmux-agent-sidebar");
});

test("repoOf never returns an empty name when worktrees is the last segment", () => {
  assert.equal(sb.repoOf("/x/worktrees"), "worktrees");
});

test("repoOf without a path is Other", () => {
  assert.equal(sb.repoOf(undefined), "Other");
});

test("statusMeta ranks needs_input first and unknown statuses last", () => {
  assert.equal(sb.statusMeta("needs_input").rank, 0);
  assert.equal(sb.statusMeta("working").rank, 1);
  assert.equal(sb.statusMeta("idle").rank, 2);
  assert.equal(sb.statusMeta("ended").rank, 3);
  assert.equal(sb.statusMeta("bogus").rank, 9);
  assert.equal(sb.statusMeta("bogus").label, "bogus");
});

test("workspace with no directory and no agents is listed under Other by title", () => {
  const r = rows([ws("w1", { title: "scratch" })]);
  assert.deepEqual(r.map((x) => x.key), ["r:Other", "t:ws:w1"]);
  assert.equal(r[1].label, "scratch");
  assert.equal(r[1].wsId, "w1");
});

test("agent with no directory or panelId uses its workspace's worktree and branch", () => {
  const r = rows([ws("w1", {
    directory: "/r/worktrees/app/main", branch: "main", dirty: true,
    agents: [agent("a1", "working")],
  })]);
  assert.deepEqual(r.map((x) => x.key), ["r:app", "t:/r/worktrees/app/main", "a:w1:a1"]);
  assert.equal(r[1].label, "main");
  assert.equal(r[1].dirty, true);
});

test("agents in one workspace but different worktrees get separate worktree rows", () => {
  const k = keys([ws("w1", {
    directory: "/r/worktrees/app/main", branch: "main",
    agents: [
      agent("a1", "working", { directory: "/r/worktrees/app/main" }),
      agent("a2", "idle", { directory: "/r/worktrees/app/feat" }),
    ],
  })]);
  assert.deepEqual(k, [
    "r:app",
    "t:/r/worktrees/app/feat", "a:w1:a2",
    "t:/r/worktrees/app/main", "a:w1:a1",
  ]);
});

test("a worktree with no branch info is labelled by its folder, not the workspace branch", () => {
  const r = rows([ws("w1", {
    directory: "/r/worktrees/app/main", branch: "main",
    agents: [agent("a2", "idle", { directory: "/r/worktrees/app/feat" })],
  })]);
  assert.equal(r.find((x) => x.key === "t:/r/worktrees/app/feat").label, "feat");
});

test("two workspaces on the same worktree path share one worktree row", () => {
  const k = keys([
    ws("w1", { directory: "/r/app", agents: [agent("a1", "working")] }),
    ws("w2", { directory: "/r/app", agents: [agent("a2", "idle")] }),
  ]);
  assert.deepEqual(k, ["r:app", "t:/r/app", "a:w1:a1", "a:w2:a2"]);
});

test("agent in a subfolder of a workspace directory belongs to that worktree", () => {
  const k = keys([ws("w1", {
    directory: "/r/app",
    agents: [agent("a1", "working", { directory: "/r/app/packages/api" })],
  })]);
  assert.deepEqual(k, ["r:app", "t:/r/app", "a:w1:a1"]);
});

test("agent branch comes from its hosting tab via panelId", () => {
  const r = rows([ws("w1", {
    directory: "/r/app", branch: "main",
    tabs: [{ id: "p1", branch: "feat/y", dirty: true }],
    agents: [agent("a1", "working", { directory: "/r/app2", panelId: "p1" })],
  })]);
  const wt = r.find((x) => x.key === "t:/r/app2");
  assert.equal(wt.label, "feat/y");
  assert.equal(wt.dirty, true);
});

test("ended agents hide 15 minutes after their last activity", () => {
  const k = keys([ws("w1", {
    directory: "/r/app",
    agents: [
      agent("old", "ended", { lastActivityAt: EPOCH - 901 }),
      agent("new", "ended", { lastActivityAt: EPOCH - 60 }),
    ],
  })]);
  assert.deepEqual(k, ["r:app", "t:/r/app", "a:w1:new"]);
});

test("a repo with an agent waiting on you sorts before alphabetically earlier repos", () => {
  const k = keys([
    ws("w1", { directory: "/r/aaa", agents: [agent("a1", "idle")] }),
    ws("w2", { directory: "/r/zzz", agents: [agent("a2", "needs_input")] }),
  ]).filter((x) => x.startsWith("r:"));
  assert.deepEqual(k, ["r:zzz", "r:aaa"]);
});

test("agents sort by status, then most recent activity", () => {
  const k = keys([ws("w1", {
    directory: "/r/app",
    agents: [
      agent("idle", "idle", { lastActivityAt: 999 }),
      agent("work-old", "working", { lastActivityAt: 10 }),
      agent("work-new", "working", { lastActivityAt: 500 }),
      agent("ask", "needs_input"),
    ],
  })]).filter((x) => x.startsWith("a:"));
  assert.deepEqual(k, ["a:w1:ask", "a:w1:work-new", "a:w1:work-old", "a:w1:idle"]);
});

test("repo rows count working, waiting and total shown agents", () => {
  const r = rows([ws("w1", {
    directory: "/r/app",
    agents: [agent("a", "working"), agent("b", "needs_input"), agent("c", "idle")],
  })]);
  assert.deepEqual(
    { working: r[0].working, waiting: r[0].waiting, total: r[0].total },
    { working: 1, waiting: 1, total: 3 },
  );
});

test("subagents follow their parent, running ones first", () => {
  const k = keys([ws("w1", {
    directory: "/r/app",
    agents: [agent("a1", "working", {
      children: [
        { id: "done", running: false, startedEpoch: 1 },
        { id: "run", running: true, startedEpoch: 5 },
      ],
    })],
  })]);
  assert.deepEqual(k.slice(2), ["a:w1:a1", "c:w1:a1:run", "c:w1:a1:done"]);
});
