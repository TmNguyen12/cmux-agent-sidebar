import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSidebar, ws, agent } from "./harness.mjs";

const EPOCH = 1000;
const sb = loadSidebar();
// The sidebar runs in its own vm realm; copy results into this realm so
// deepStrictEqual compares values, not prototypes.
const host = (v) => JSON.parse(JSON.stringify(v));
const rows = (workspaces, epoch = EPOCH) => host(sb.buildRows(workspaces, epoch));
const keys = (workspaces, epoch) => rows(workspaces, epoch).map((r) => r.key);
const group = (r, key) => r.find((x) => x.key === key);

test("statusMeta orders waiting, running, done, ended, then unknown", () => {
  assert.deepEqual(
    ["needs_input", "working", "idle", "ended", "bogus"].map((s) => sb.statusMeta(s).rank),
    [0, 1, 2, 3, 9],
  );
});

test("statusMeta marks done with a green dot", () => {
  assert.equal(sb.statusMeta("idle").mark, "●");
  assert.equal(sb.statusMeta("idle").color, "#a6e3a1");
  assert.equal(sb.statusMeta("working").color, "#89b4fa");
  assert.equal(sb.statusMeta("needs_input").color, "#fab387");
});

test("statusMeta ignores inherited object keys", () => {
  assert.equal(sb.statusMeta("constructor").rank, 9);
});

test("kindSymbol is a star for Claude, a diamond for Codex, else a letter", () => {
  assert.equal(sb.kindSymbol("claude"), "✻");
  assert.equal(sb.kindSymbol("codex"), "◆");
  assert.equal(sb.kindSymbol("opencode"), "O");
  assert.equal(sb.kindSymbol(undefined), "?");
});

test("groupLabel names a worktree by its folder, not a possibly stale branch", () => {
  assert.deepEqual(host(sb.groupLabel("/r/worktrees/app/feat-x", "main")),
    { groupKind: "worktree", label: "app / feat-x" });
});

test("groupLabel keeps a nested worktree folder", () => {
  assert.deepEqual(host(sb.groupLabel("/r/worktrees/app/codex/setup", "main")),
    { groupKind: "worktree", label: "app / codex/setup" });
});

test("groupLabel names a worktree when the branch is unknown", () => {
  assert.deepEqual(host(sb.groupLabel("/r/worktrees/app/feat-x", undefined)),
    { groupKind: "worktree", label: "app / feat-x" });
});

test("groupLabel names a git checkout by folder and branch", () => {
  assert.deepEqual(host(sb.groupLabel("/Users/t/dotfiles", "master")),
    { groupKind: "repo", label: "dotfiles · master" });
});

test("groupLabel names a plain folder by its name", () => {
  assert.deepEqual(host(sb.groupLabel("/Users/t/Repos", undefined)),
    { groupKind: "folder", label: "Repos" });
});

test("groupLabel treats a bare worktrees folder as a plain folder", () => {
  assert.deepEqual(host(sb.groupLabel("/r/worktrees/app", undefined)),
    { groupKind: "folder", label: "app" });
});

test("groupLabel labels the root folder /", () => {
  assert.equal(sb.groupLabel("/", undefined).label, "/");
});

test("agentTitle prefers the tab title", () => {
  assert.equal(sb.agentTitle(agent("a", "working", { title: "first prompt" }), { title: "Fix ingest retry" }, "/r/app"),
    "Fix ingest retry");
});

test("agentTitle skips a path-like or name-like tab title for the first prompt", () => {
  const a = agent("a", "working", { title: "first prompt", kind: "claude" });
  assert.equal(sb.agentTitle(a, { title: "~/dotfiles" }, "/r/app"), "first prompt");
  assert.equal(sb.agentTitle(a, { title: "/r/app" }, "/r/app"), "first prompt");
  assert.equal(sb.agentTitle(a, { title: "Claude" }, "/r/app"), "first prompt");
});

test("agentTitle falls back to the folder name", () => {
  assert.equal(sb.agentTitle(agent("a", "working"), undefined, "/r/app"), "app");
});

test("a workspace with no folder is its own group, named by title", () => {
  const r = rows([ws("w1", { title: "scratch" })]);
  assert.deepEqual(r.map((x) => x.key), ["g:ws:w1"]);
  assert.equal(r[0].label, "scratch");
  assert.equal(r[0].groupKind, "folder");
});

test("an agent with no folder or tab lands in its workspace's group", () => {
  const r = rows([ws("w1", {
    directory: "/r/worktrees/app/main", branch: "main", dirty: true,
    agents: [agent("a1", "working")],
  })]);
  assert.deepEqual(r.map((x) => x.key), ["g:/r/worktrees/app/main", "a:w1:a1"]);
  assert.equal(r[0].label, "app / main");
});

test("a worktree group shows no dirty mark, since cmux's flag can be stale", () => {
  const r = rows([ws("w1", {
    directory: "/r/worktrees/app/feat", branch: "main", dirty: true,
    agents: [agent("a1", "working")],
  })]);
  assert.equal(r[0].label, "app / feat");
  assert.equal(r[0].dirty, false);
});

test("agents in one workspace but different worktrees get separate groups", () => {
  const k = keys([ws("w1", {
    directory: "/r/worktrees/app/main", branch: "main",
    agents: [
      agent("a1", "working", { directory: "/r/worktrees/app/main" }),
      agent("a2", "idle", { directory: "/r/worktrees/app/feat" }),
    ],
  })]);
  assert.deepEqual(k, ["g:/r/worktrees/app/main", "a:w1:a1", "g:/r/worktrees/app/feat", "a:w1:a2"]);
});

test("two workspaces on one folder share one group", () => {
  const k = keys([
    ws("w1", { directory: "/r/app", agents: [agent("a1", "working")] }),
    ws("w2", { directory: "/r/app", agents: [agent("a2", "idle")] }),
  ]);
  assert.deepEqual(k, ["g:/r/app", "a:w1:a1", "a:w2:a2"]);
});

test("an agent in a subfolder belongs to the workspace folder's group", () => {
  const k = keys([ws("w1", {
    directory: "/r/app", agents: [agent("a1", "working", { directory: "/r/app/packages/api" })],
  })]);
  assert.deepEqual(k, ["g:/r/app", "a:w1:a1"]);
});

test("a trailing slash does not split one folder into two groups", () => {
  const k = keys([ws("w1", { directory: "/r/app/", agents: [agent("a1", "working", { directory: "/r/app" })] })]);
  assert.deepEqual(k, ["g:/r/app", "a:w1:a1"]);
});

test("an empty agent folder falls back to its workspace folder", () => {
  const k = keys([ws("w1", { directory: "/r/app", agents: [agent("a1", "working", { directory: "" })] })]);
  assert.deepEqual(k, ["g:/r/app", "a:w1:a1"]);
});

test("a workspace at / next to a folderless workspace does not throw", () => {
  const w = [ws("w2", { title: "scratch" }), ws("w1", { directory: "/" })];
  assert.doesNotThrow(() => rows(w));
  assert.equal(group(rows(w), "g:/").label, "/");
});

test("an agent's tab branch labels a group the workspace doesn't own", () => {
  const r = rows([ws("w1", {
    directory: "/r/app", branch: "main",
    tabs: [{ id: "p1", title: "x", branch: "feat/y", dirty: true }],
    agents: [agent("a1", "working", { directory: "/r/app2", panelId: "p1" })],
  })]);
  assert.equal(group(r, "g:/r/app2").label, "app2 · feat/y");
  assert.equal(group(r, "g:/r/app2").dirty, true);
});

test("ended agents hide 15 minutes after their last activity", () => {
  const k = keys([ws("w1", {
    directory: "/r/app",
    agents: [
      agent("old", "ended", { lastActivityAt: EPOCH - 901 }),
      agent("new", "ended", { lastActivityAt: EPOCH - 60 }),
    ],
  })]);
  assert.deepEqual(k, ["g:/r/app", "a:w1:new"]);
});

test("groups keep cmux's workspace order, not urgency", () => {
  const k = keys([
    ws("w1", { directory: "/r/zzz", index: 0, agents: [agent("a1", "idle")] }),
    ws("w2", { directory: "/r/aaa", index: 1, agents: [agent("a2", "needs_input")] }),
  ]).filter((x) => x.startsWith("g:"));
  assert.deepEqual(k, ["g:/r/zzz", "g:/r/aaa"]);
});

test("agents in a group sort by status, then most recent activity", () => {
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

test("group rows count running, waiting and total agents", () => {
  const r = rows([ws("w1", {
    directory: "/r/app", agents: [agent("a", "working"), agent("b", "needs_input"), agent("c", "idle")],
  })]);
  assert.deepEqual({ working: r[0].working, waiting: r[0].waiting, total: r[0].total },
    { working: 1, waiting: 1, total: 3 });
});

test("a group row selects the workspace that owns the folder", () => {
  const r = rows([
    ws("w1", { directory: "/r/a", agents: [agent("a1", "working", { directory: "/r/b" })] }),
    ws("w2", { directory: "/r/b" }),
  ]);
  assert.equal(group(r, "g:/r/b").wsId, "w2");
});

test("two workspaces on one folder: the group targets the selected one", () => {
  const r = rows([ws("w1", { directory: "/r/app" }), ws("w2", { directory: "/r/app", selected: true })]);
  assert.equal(group(r, "g:/r/app").wsId, "w2");
});

test("agent rows carry their title, kind symbol and running subagent count", () => {
  const r = rows([ws("w1", {
    directory: "/r/app",
    tabs: [{ id: "p1", title: "Fix ingest retry" }],
    agents: [agent("a1", "working", {
      panelId: "p1",
      children: [{ id: "c1", running: true }, { id: "c2", running: true }, { id: "c3", running: false }],
    })],
  })]);
  const a = group(r, "a:w1:a1");
  assert.equal(a.title, "Fix ingest retry");
  assert.equal(a.symbol, "✻");
  assert.equal(a.subagents, 2);
});

test("the list is capped with a +N more row at the end", () => {
  const many = Array.from({ length: 300 }, (_, i) => ws("w" + i, { directory: "/r/repo" + i }));
  const r = rows(many);
  assert.equal(r.length, 200 + 1);
  assert.equal(r[r.length - 1].kind, "more");
  assert.equal(r[r.length - 1].text, "+100 more");
});

test("kindColor paints Claude in its clay color and Codex in the text color", () => {
  assert.equal(sb.kindColor("claude"), "#D97757");
  assert.equal(sb.kindColor("codex"), "primary");
  assert.equal(sb.kindColor("opencode"), "secondary");
  assert.equal(sb.kindColor("constructor"), "secondary");
});

test("a group owned by a workspace shows that workspace's shortcut", () => {
  const r = rows([
    ws("w1", { directory: "/r/a", index: 0 }),
    ws("w2", { directory: "/r/b", index: 1 }),
  ]);
  assert.equal(group(r, "g:/r/a").shortcut, "⌘1");
  assert.equal(group(r, "g:/r/b").shortcut, "⌘2");
});

test("a folder-only group points at the workspace hosting its agents", () => {
  const r = rows([ws("w1", { directory: "/r/a", index: 0, agents: [agent("a1", "working", { directory: "/home" })] })]);
  assert.equal(group(r, "g:/home").shortcut, "in ⌘1");
});

test("workspaces past the ninth get no shortcut", () => {
  const r = rows([ws("w1", { directory: "/r/a", index: 9 })]);
  assert.equal(group(r, "g:/r/a").shortcut, "");
});

test("a shared folder's shortcut follows the workspace its row selects", () => {
  const r = rows([ws("w1", { directory: "/r/app", index: 0 }), ws("w2", { directory: "/r/app", index: 1, selected: true })]);
  assert.equal(group(r, "g:/r/app").shortcut, "⌘2");
});

test("a workspace with no folder shows its own shortcut", () => {
  const r = rows([ws("w1", { title: "scratch", index: 2 })]);
  assert.equal(group(r, "g:ws:w1").shortcut, "⌘3");
});

test("an agent row is focused when its tab is focused in the selected workspace", () => {
  const tabs = [{ id: "p1", title: "x", focused: true }, { id: "p2", title: "y", focused: false }];
  const r = rows([
    ws("w1", { directory: "/r/a", selected: true, tabs, agents: [agent("a1", "working", { panelId: "p1" }), agent("a2", "idle", { panelId: "p2" })] }),
    ws("w2", { directory: "/r/b", tabs, agents: [agent("b1", "working", { panelId: "p1" })] }),
  ]);
  assert.equal(group(r, "a:w1:a1").focused, true);
  assert.equal(group(r, "a:w1:a2").focused, false);
  assert.equal(group(r, "a:w2:b1").focused, false);
});

test("an agent in a workspace with several tabs shows its tab key", () => {
  const tabs = [{ id: "p1", title: "x" }, { id: "p2", title: "y" }];
  const r = rows([ws("w1", {
    directory: "/r/a", tabs,
    agents: [agent("a1", "working", { panelId: "p2" }), agent("a2", "idle", { panelId: "p1" })],
  })]);
  assert.equal(group(r, "a:w1:a1").tabKey, "⌃2");
  assert.equal(group(r, "a:w1:a2").tabKey, "⌃1");
});

test("no tab key when the workspace has one tab, the tab is unknown, or past the ninth", () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ id: "p" + i, title: "t" }));
  const r = rows([
    ws("w1", { directory: "/r/a", tabs: [{ id: "p1", title: "x" }], agents: [agent("a1", "working", { panelId: "p1" })] }),
    ws("w2", { directory: "/r/b", tabs: ten, agents: [agent("b1", "working"), agent("b2", "idle", { panelId: "p9" })] }),
  ]);
  assert.equal(group(r, "a:w1:a1").tabKey, "");
  assert.equal(group(r, "a:w2:b1").tabKey, "");
  assert.equal(group(r, "a:w2:b2").tabKey, "");
});
