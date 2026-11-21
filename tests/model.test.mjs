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

test("statusMeta shows an unknown status as a gray ring with its name", () => {
  assert.deepEqual(host(sb.statusMeta("bogus")), { mark: "○", label: "bogus", color: "#6c7086" });
});

test("statusMeta marks done with a green dot", () => {
  assert.equal(sb.statusMeta("idle").mark, "●");
  assert.equal(sb.statusMeta("idle").color, "#a6e3a1");
  assert.equal(sb.statusMeta("working").color, "#89b4fa");
  assert.equal(sb.statusMeta("needs_input").color, "#fab387");
});

test("statusMeta ignores inherited object keys", () => {
  assert.equal(sb.statusMeta("constructor").label, "constructor");
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

test("groupLabel names a worktree by its first folder, so a subfolder doesn't rename it", () => {
  assert.deepEqual(host(sb.groupLabel("/r/worktrees/app/feat/pkg/api", "main")),
    { groupKind: "worktree", label: "app / feat" });
});

test("worktreeRoot trims a worktree subfolder and leaves other folders alone", () => {
  assert.equal(sb.worktreeRoot("/r/worktrees/app/feat/pkg/api"), "/r/worktrees/app/feat");
  assert.equal(sb.worktreeRoot("/r/worktrees/app/feat"), "/r/worktrees/app/feat");
  assert.equal(sb.worktreeRoot("/r/app/pkg"), "/r/app/pkg");
  assert.equal(sb.worktreeRoot(undefined), undefined);
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
  assert.deepEqual(r.map((x) => x.key), ["r:folders", "g:ws:w1"]);
  assert.equal(r[1].label, "scratch");
  assert.equal(r[1].groupKind, "folder");
});

test("an agent with no folder or tab lands in its workspace's group", () => {
  const r = rows([ws("w1", {
    directory: "/r/worktrees/app/main", branch: "main", dirty: true,
    agents: [agent("a1", "working")],
  })]);
  assert.deepEqual(r.map((x) => x.key), ["r:/r/app", "g:/r/worktrees/app/main", "a:w1:a1"]);
  assert.equal(group(r, "g:/r/worktrees/app/main").label, "main");
});

test("a worktree group shows no dirty mark, since cmux's flag can be stale", () => {
  const r = rows([ws("w1", {
    directory: "/r/worktrees/app/feat", branch: "main", dirty: true,
    agents: [agent("a1", "working")],
  })]);
  assert.equal(group(r, "g:/r/worktrees/app/feat").label, "feat");
  assert.equal(group(r, "g:/r/worktrees/app/feat").dirty, false);
});

test("repoOf finds the repo from the main checkout or a worktree folder", () => {
  assert.deepEqual(host(sb.repoOf("/r/app", "main")), { path: "/r/app", name: "app", checkout: "main", main: true });
  assert.deepEqual(host(sb.repoOf("/r/worktrees/app/feat/pkg", "main")),
    { path: "/r/app", name: "app", checkout: "feat", main: false });
});

test("an agent in a worktree subfolder joins its worktree's group", () => {
  const r = rows([ws("w1", {
    directory: "/r/app", branch: "main",
    agents: [agent("a1", "working", { directory: "/r/worktrees/app/feat/ble-provisioner" })],
  })]);
  assert.deepEqual(r.map((x) => x.key), ["r:/r/app", "g:/r/app", "g:/r/worktrees/app/feat", "a:w1:a1"]);
  assert.equal(group(r, "g:/r/worktrees/app/feat").label, "feat");
});

test("a workspace sitting in a worktree subfolder groups as the worktree", () => {
  assert.deepEqual(keys([ws("w1", { directory: "/r/worktrees/app/feat/pkg" })]),
    ["r:/r/app", "g:/r/worktrees/app/feat"]);
});

test("a workspace in a checkout subfolder joins the open checkout that holds it", () => {
  const k = keys([
    ws("w1", { directory: "/r/app", branch: "main", index: 0 }),
    ws("w2", { directory: "/r/app/_claude/plans", branch: "main", index: 1, agents: [agent("a1", "working")] }),
  ]);
  assert.deepEqual(k, ["r:/r/app", "g:/r/app", "a:w2:a1", "s:w1"]);
});

test("a folded subfolder workspace doesn't take the checkout's row from its workspace", () => {
  const r = rows([
    ws("w2", {
      directory: "/r/app/_claude", branch: "main", dirty: true, index: 0,
      agents: [agent("a1", "working"), agent("a2", "idle", { directory: "/r/app" })],
    }),
    ws("w1", { directory: "/r/app", branch: "main", dirty: false, index: 1 }),
  ]);
  const g = group(r, "g:/r/app");
  assert.equal(g.wsId, "w1");
  assert.equal(g.shortcut, "⌘2");
  assert.equal(g.selected, false);
  assert.equal(g.dirty, false);
});

test("a folded workspace listed first leaves the checkout's dirty state alone", () => {
  const g = group(rows([
    ws("w2", { directory: "/r/app/_claude", branch: "main", dirty: false, index: 0 }),
    ws("w1", { directory: "/r/app", branch: "main", dirty: true, index: 1 }),
  ]), "g:/r/app");
  assert.equal(g.dirty, true);
});

test("a selected folded workspace takes the checkout's row but not its dirty state", () => {
  const g = group(rows([
    ws("w1", { directory: "/r/app", branch: "main", dirty: false, index: 0 }),
    ws("w2", { directory: "/r/app/_claude", branch: "main", dirty: true, index: 1, selected: true }),
  ]), "g:/r/app");
  assert.equal(g.wsId, "w2");
  assert.equal(g.shortcut, "⌘2");
  assert.equal(g.selected, true);
  assert.equal(g.dirty, false);
});

test("a worktree inside a checkout keeps its row even with the checkout's stale branch", () => {
  assert.deepEqual(keys([
    ws("w1", { directory: "/r/app", branch: "main", index: 0 }),
    ws("w2", { directory: "/r/app/.claude/worktrees/feat", branch: "main", index: 1 }),
  ]), ["r:/r/app", "g:/r/app", "r:/r/app/.claude/worktrees/feat", "g:/r/app/.claude/worktrees/feat"]);
});

test("a repo nested in a checkout on another branch keeps its own row", () => {
  assert.deepEqual(keys([
    ws("w1", { directory: "/r/app", branch: "main", index: 0 }),
    ws("w2", { directory: "/r/app/vendor/lib", branch: "dev", index: 1 }),
  ]), ["r:/r/app", "g:/r/app", "r:/r/app/vendor/lib", "g:/r/app/vendor/lib"]);
});

test("an agent in a _ folder with its tab's branch is a plain folder", () => {
  const r = rows([ws("w1", {
    directory: "/Users/t",
    tabs: [{ id: "p1", title: "x", branch: "main" }],
    agents: [agent("a1", "working", { directory: "/r/app/_claude", panelId: "p1" })],
  })]);
  assert.deepEqual(r.map((x) => x.key), ["r:folders", "g:/Users/t", "g:/r/app/_claude", "a:w1:a1"]);
  assert.equal(group(r, "g:/r/app/_claude").label, "_claude");
});

test("a workspace folds only into the outermost open checkout on its branch", () => {
  assert.deepEqual(keys([
    ws("w1", { directory: "/r/a", branch: "main", index: 0 }),
    ws("w2", { directory: "/r/a/b", branch: "main", index: 1 }),
    ws("w3", { directory: "/r/a/b/c", branch: "main", index: 2 }),
  ]), ["r:/r/a", "g:/r/a", "s:w1", "s:w2", "s:w3"]);
  assert.deepEqual(keys([
    ws("w1", { directory: "/r", branch: "main", index: 0 }),
    ws("w2", { directory: "/r/app/.claude/worktrees/feat", branch: "feat", index: 1 }),
  ]), ["r:/r", "g:/r", "r:/r/app/.claude/worktrees/feat", "g:/r/app/.claude/worktrees/feat"]);
});

test("a workspace doesn't fold into a folder with no branch or a sibling sharing a prefix", () => {
  assert.deepEqual(keys([
    ws("w1", { directory: "/r/app", index: 0 }),
    ws("w2", { directory: "/r/app/sub", branch: "main", index: 1 }),
  ]), ["r:/r/app/sub", "g:/r/app/sub", "r:folders", "g:/r/app"]);
  assert.deepEqual(keys([
    ws("w1", { directory: "/r/app", branch: "main", index: 0 }),
    ws("w2", { directory: "/r/app2", branch: "main", index: 1 }),
  ]), ["r:/r/app", "g:/r/app", "r:/r/app2", "g:/r/app2"]);
});

test("a _ or . folder with a branch is a plain folder, not a repo", () => {
  assert.equal(sb.repoOf("/r/app/_claude", "main"), undefined);
  assert.equal(sb.repoOf("/r/app/.github", "main"), undefined);
  assert.deepEqual(host(sb.groupLabel("/r/app/_claude", "main")), { groupKind: "folder", label: "_claude" });
  assert.deepEqual(keys([ws("w1", { directory: "/r/app/_claude", branch: "main" })]),
    ["r:folders", "g:/r/app/_claude"]);
});

test("repoOf leaves a folder with no known branch alone", () => {
  assert.equal(sb.repoOf("/Users/t/Documents", undefined), undefined);
});

test("a repo's checkouts sit under one repo row, main checkout first", () => {
  const r = rows([ws("w1", {
    directory: "/x/zrepo", branch: "main",
    agents: [
      agent("a1", "working", { directory: "/x/worktrees/zrepo/feat" }),
      agent("a2", "idle", { directory: "/x/zrepo" }),
    ],
  })]);
  assert.deepEqual(r.map((x) => x.key), ["r:/x/zrepo", "g:/x/zrepo", "a:w1:a2", "g:/x/worktrees/zrepo/feat", "a:w1:a1"]);
  assert.deepEqual(r.map((x) => x.label).filter(Boolean), ["zrepo", "main", "feat"]);
  assert.equal(r[0].kind, "repo");
  assert.equal(group(r, "g:/x/zrepo").nested, true);
});

test("a lone git checkout still gets a repo row", () => {
  assert.deepEqual(keys([ws("w1", { directory: "/Users/t/dotfiles", branch: "master" })]),
    ["r:/Users/t/dotfiles", "g:/Users/t/dotfiles"]);
});

test("plain folders and folderless workspaces sit under one Folders header after the repos", () => {
  const r = rows([
    ws("w1", { directory: "/Users/t/Documents", index: 0 }),
    ws("w2", { directory: "/r/app", branch: "main", index: 1 }),
    ws("w3", { title: "scratch", index: 2 }),
  ]);
  assert.deepEqual(r.map((x) => x.key),
    ["r:/r/app", "g:/r/app", "r:folders", "g:/Users/t/Documents", "g:ws:w3"]);
  assert.equal(group(r, "r:folders").label, "Folders");
  assert.equal(group(r, "g:/Users/t/Documents").label, "Documents");
  assert.equal(group(r, "g:/Users/t/Documents").nested, true);
  assert.equal(group(r, "g:ws:w3").label, "scratch");
});

test("a main checkout with no known branch joins its worktrees' repo", () => {
  const r = rows([ws("w1", {
    directory: "/r/app", agents: [agent("a1", "working", { directory: "/r/worktrees/app/feat" })],
  })]);
  assert.deepEqual(r.map((x) => x.key), ["r:/r/app", "g:/r/app", "g:/r/worktrees/app/feat", "a:w1:a1"]);
  assert.equal(group(r, "g:/r/app").label, "app");
});

test("a repo sits at its earliest workspace and keeps its checkouts together", () => {
  const k = keys([
    ws("w1", { directory: "/r/app", branch: "main", index: 0 }),
    ws("w2", { directory: "/r/other", branch: "x", index: 1 }),
    ws("w3", { directory: "/r/worktrees/app/feat", index: 2 }),
  ]);
  assert.deepEqual(k, ["r:/r/app", "g:/r/app", "g:/r/worktrees/app/feat", "r:/r/other", "g:/r/other"]);
});

test("agents in one workspace but different worktrees get separate groups", () => {
  const k = keys([ws("w1", {
    directory: "/r/worktrees/app/main", branch: "main",
    agents: [
      agent("a1", "working", { directory: "/r/worktrees/app/main" }),
      agent("a2", "idle", { directory: "/r/worktrees/app/feat" }),
    ],
  })]);
  assert.deepEqual(k, ["r:/r/app", "g:/r/worktrees/app/feat", "a:w1:a2", "g:/r/worktrees/app/main", "a:w1:a1"]);
});

test("groups in one workspace keep their order when tab focus moves the workspace folder", () => {
  const agents = [
    agent("a1", "working", { directory: "/r/worktrees/app/main" }),
    agent("a2", "idle", { directory: "/r/worktrees/app/feat" }),
  ];
  const onMain = keys([ws("w1", { directory: "/r/worktrees/app/main", agents })]);
  const onFeat = keys([ws("w1", { directory: "/r/worktrees/app/feat", agents })]);
  assert.deepEqual(onMain, onFeat);
});

test("two workspaces on one folder share one group", () => {
  const k = keys([
    ws("w1", { directory: "/r/app", agents: [agent("a1", "working")] }),
    ws("w2", { directory: "/r/app", agents: [agent("a2", "idle")] }),
  ]);
  assert.deepEqual(k, ["r:folders", "g:/r/app", "a:w1:a1", "a:w2:a2"]);
});

test("an agent in a subfolder belongs to the workspace folder's group", () => {
  const k = keys([ws("w1", {
    directory: "/r/app", agents: [agent("a1", "working", { directory: "/r/app/packages/api" })],
  })]);
  assert.deepEqual(k, ["r:folders", "g:/r/app", "a:w1:a1"]);
});

test("a trailing slash does not split one folder into two groups", () => {
  const k = keys([ws("w1", { directory: "/r/app/", agents: [agent("a1", "working", { directory: "/r/app" })] })]);
  assert.deepEqual(k, ["r:folders", "g:/r/app", "a:w1:a1"]);
});

test("an empty agent folder falls back to its workspace folder", () => {
  const k = keys([ws("w1", { directory: "/r/app", agents: [agent("a1", "working", { directory: "" })] })]);
  assert.deepEqual(k, ["r:folders", "g:/r/app", "a:w1:a1"]);
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
  assert.equal(group(r, "g:/r/app2").label, "feat/y");
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
  assert.deepEqual(k, ["r:folders", "g:/r/app", "a:w1:new"]);
});

test("groups keep cmux's workspace order, not urgency", () => {
  const k = keys([
    ws("w1", { directory: "/r/zzz", index: 0, agents: [agent("a1", "idle")] }),
    ws("w2", { directory: "/r/aaa", index: 1, agents: [agent("a2", "needs_input")] }),
  ]).filter((x) => x.startsWith("g:"));
  assert.deepEqual(k, ["g:/r/zzz", "g:/r/aaa"]);
});

test("agents in a group keep tab order, not status or activity", () => {
  const k = keys([ws("w1", {
    directory: "/r/app",
    tabs: [{ id: "p1", title: "x" }, { id: "p2", title: "y" }, { id: "p3", title: "z" }],
    agents: [
      agent("ask", "needs_input", { panelId: "p3" }),
      agent("work", "working", { panelId: "p1", lastActivityAt: 10 }),
      agent("idle", "idle", { panelId: "p2", lastActivityAt: 999 }),
    ],
  })]).filter((x) => x.startsWith("a:"));
  assert.deepEqual(k, ["a:w1:work", "a:w1:idle", "a:w1:ask"]);
});

test("agents with no known tab come after the rest, by id", () => {
  const k = keys([ws("w1", {
    directory: "/r/app",
    tabs: [{ id: "p1", title: "x" }],
    agents: [agent("b", "working"), agent("a", "needs_input"), agent("t", "idle", { panelId: "p1" })],
  })]).filter((x) => x.startsWith("a:"));
  assert.deepEqual(k, ["a:w1:t", "a:w1:a", "a:w1:b"]);
});

test("agents from two workspaces on one folder keep workspace order", () => {
  const k = keys([
    ws("w1", { directory: "/r/app", index: 0, agents: [agent("z", "idle")] }),
    ws("w2", { directory: "/r/app", index: 1, agents: [agent("a", "needs_input")] }),
  ]).filter((x) => x.startsWith("a:"));
  assert.deepEqual(k, ["a:w1:z", "a:w2:a"]);
});

test("group rows count running, waiting and total agents", () => {
  const r = rows([ws("w1", {
    directory: "/r/app", agents: [agent("a", "working"), agent("b", "needs_input"), agent("c", "idle")],
  })]);
  assert.deepEqual({ working: r[1].working, waiting: r[1].waiting, total: r[1].total },
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

test("a workspace with no agents on a shared folder gets a shell row after the agents", () => {
  const r = rows([
    ws("w1", { directory: "/r/app", index: 0, title: "zsh" }),
    ws("w2", { directory: "/r/app", index: 1, agents: [agent("a1", "working")] }),
  ]);
  assert.deepEqual(r.map((x) => x.key), ["r:folders", "g:/r/app", "a:w2:a1", "s:w1"]);
  assert.deepEqual(group(r, "s:w1"), { key: "s:w1", kind: "shell", wsId: "w1", title: "zsh", shortcut: "⌘1", focused: false });
});

test("two workspaces with no agents on one folder get a shell row each, in workspace order", () => {
  const k = keys([
    ws("w2", { directory: "/r/app", index: 1 }),
    ws("w1", { directory: "/r/app", index: 0 }),
  ]);
  assert.deepEqual(k, ["r:folders", "g:/r/app", "s:w1", "s:w2"]);
});

test("a folder's only workspace gets no shell row", () => {
  assert.deepEqual(keys([ws("w1", { directory: "/r/app" })]), ["r:folders", "g:/r/app"]);
});

test("a folded subfolder workspace with no agents gets a shell row under its checkout", () => {
  const k = keys([
    ws("w1", { directory: "/r/app", branch: "main", index: 0, agents: [agent("a1", "working")] }),
    ws("w2", { directory: "/r/app/_claude", branch: "main", index: 1 }),
  ]);
  assert.deepEqual(k, ["r:/r/app", "g:/r/app", "a:w1:a1", "s:w2"]);
});

test("a workspace with no folder gets no shell row", () => {
  const k = keys([ws("w1", { title: "scratch", index: 0 }), ws("w2", { title: "scratch", index: 1 })]);
  assert.deepEqual(k, ["r:folders", "g:ws:w1", "g:ws:w2"]);
});

test("an agent's folder doesn't count as a workspace on that folder", () => {
  const k = keys([
    ws("w1", { directory: "/r/a", index: 0, agents: [agent("a1", "working", { directory: "/r/b" })] }),
    ws("w2", { directory: "/r/b", index: 1 }),
  ]);
  assert.deepEqual(k, ["r:folders", "g:/r/a", "g:/r/b", "a:w1:a1"]);
});

test("a workspace whose agents have all ended and hidden gets a shell row on a shared folder", () => {
  const k = keys([
    ws("w1", { directory: "/r/app", index: 0, agents: [agent("old", "ended", { lastActivityAt: EPOCH - 901 })] }),
    ws("w2", { directory: "/r/app", index: 1, agents: [agent("a2", "idle")] }),
  ]);
  assert.deepEqual(k, ["r:folders", "g:/r/app", "a:w2:a2", "s:w1"]);
});

test("a shell row with no workspace title is titled shell", () => {
  const r = rows([ws("w1", { directory: "/r/app", title: "" }), ws("w2", { directory: "/r/app" })]);
  assert.equal(group(r, "s:w1").title, "shell");
  assert.equal(group(r, "s:w2").title, "w2");
});

test("a shell row shows its own workspace's key, none past the ninth", () => {
  const r = rows([
    ws("w1", { directory: "/r/app", index: 1 }),
    ws("w2", { directory: "/r/app", index: 9, selected: true }),
  ]);
  assert.equal(group(r, "g:/r/app").shortcut, "");
  assert.equal(group(r, "s:w1").shortcut, "⌘2");
  assert.equal(group(r, "s:w2").shortcut, "");
});

test("a shell row is focused when its workspace is selected", () => {
  const r = rows([ws("w1", { directory: "/r/app" }), ws("w2", { directory: "/r/app", selected: true })]);
  assert.equal(group(r, "s:w1").focused, false);
  assert.equal(group(r, "s:w2").focused, true);
});

test("shell rows don't count toward a group's agents", () => {
  const r = rows([
    ws("w1", { directory: "/r/app", agents: [agent("a", "working"), agent("b", "needs_input")] }),
    ws("w2", { directory: "/r/app" }),
    ws("w3", { directory: "/r/app" }),
  ]);
  const g = group(r, "g:/r/app");
  assert.deepEqual({ working: g.working, waiting: g.waiting, total: g.total }, { working: 1, waiting: 1, total: 2 });
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
  assert.equal(r[r.length - 1].text, "+101 more");
});

test("shell rows count toward the row cap", () => {
  const many = Array.from({ length: 300 }, (_, i) => ws("w" + i, { directory: "/r/app", index: i }));
  const r = rows(many);
  assert.equal(r.length, 200 + 1);
  assert.equal(r[r.length - 2].kind, "shell");
  assert.equal(r[r.length - 1].text, "+102 more");
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

test("a folder-only group shows the key of the workspace hosting its agents", () => {
  const r = rows([ws("w1", { directory: "/r/a", index: 0, agents: [agent("a1", "working", { directory: "/home" })] })]);
  assert.equal(group(r, "g:/home").shortcut, "⌘1");
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

test("asksQuestion finds a question on the last line", () => {
  assert.equal(sb.asksQuestion("Both tests pass.\n\nShould I push the branch?"), true);
  assert.equal(sb.asksQuestion("Should I push the branch？"), true);
});

test("asksQuestion sees through closing markdown, quotes and brackets", () => {
  assert.equal(sb.asksQuestion("**Should I push the branch?**"), true);
  assert.equal(sb.asksQuestion("(or did you mean `main`?)"), true);
});

test("asksQuestion finds a question above its list of options", () => {
  const message = [
    "Which approach do you want?",
    "",
    "1. Extend the existing table",
    "   - one migration",
    "   - no new joins",
    "2. Add a new table",
    "   - two migrations",
    "",
    "I'd pick the first.",
    "[confidence: 8/10 — read both schemas]",
  ].join("\n");
  assert.equal(sb.asksQuestion(message), true);
});

test("asksQuestion finds a question asked in a list item", () => {
  assert.equal(sb.asksQuestion("Two things are open.\n- Should the limit be 50?\n- The name is fine."), true);
});

test("asksQuestion treats a confidence score under 7 as a question", () => {
  assert.equal(sb.asksQuestion("I could not find the caller.\n[confidence: 6/10 — inferred]"), true);
  assert.equal(sb.asksQuestion("I could not find the caller.\n**[Confidence: 6.5 / 10]**"), true);
  assert.equal(sb.asksQuestion("Fixed and tested.\n[confidence: 7/10 — ran the suite]"), false);
});

test("asksQuestion says no for a finished report", () => {
  const message = [
    "## What changed",
    "- Retries now back off.",
    "- The test covers three attempts.",
    "",
    "All 42 tests pass.",
    "[confidence: 9/10 — ran the suite]",
  ].join("\n");
  assert.equal(sb.asksQuestion(message), false);
  assert.equal(sb.asksQuestion(""), false);
  assert.equal(sb.asksQuestion(undefined), false);
});

test("asksQuestion ignores a question mark inside a line or a link", () => {
  assert.equal(sb.asksQuestion("See https://example.com/search?q=cmux for more."), false);
  assert.equal(sb.asksQuestion("Sources:\n- [Why hooks?](https://example.com/hooks)"), false);
});

test("asksQuestion reads three prose lines back, however many list lines sit between", () => {
  const options = Array.from({ length: 12 }, (_, i) => "- option " + i);
  assert.equal(sb.asksQuestion(["Pick one?", ...options, "One.", "Two."].join("\n")), true);
  assert.equal(sb.asksQuestion(["Pick one?", ...options, "One.", "Two.", "Three."].join("\n")), false);
});

test("asksQuestion stops 40 lines from the end", () => {
  const options = (n) => Array.from({ length: n }, (_, i) => "- option " + i);
  assert.equal(sb.asksQuestion(["Pick one?", ...options(39)].join("\n")), true);
  assert.equal(sb.asksQuestion(["Pick one?", ...options(40)].join("\n")), false);
});

test("asksQuestion reads only the end of a very long message", () => {
  assert.equal(sb.asksQuestion("Is this right?\n" + "x".repeat(5000)), false);
});

test("asksQuestion finds the marker at the start of a reply cut short by cmux", () => {
  const head = "Needs you: Which fix do you want for the question flag? ## What this means - The flag only fires on short replies. - The README overstates it. ## Options 1. Agents put the question fi…";
  assert.equal(sb.asksQuestion(head), true);
  assert.equal(sb.asksQuestion("Needs you: pick a region.\n\nThe rest is done."), true);
});

test("asksQuestion sees the marker through markdown, case and leading space", () => {
  assert.equal(sb.asksQuestion("**Needs you:** pick a region."), true);
  assert.equal(sb.asksQuestion("**Needs you**: pick a region."), true);
  assert.equal(sb.asksQuestion("## needs you: pick a region."), true);
  assert.equal(sb.asksQuestion("\n  > NEEDS YOU: pick a region."), true);
});

test("asksQuestion wants the marker first, whole and with its colon", () => {
  assert.equal(sb.asksQuestion("Done. Needs you: nothing, I was only quoting the marker."), false);
  assert.equal(sb.asksQuestion("Needs you to restart the session. Everything else is done."), false);
  assert.equal(sb.asksQuestion("Needs your review: nothing is blocked."), false);
  assert.equal(sb.asksQuestion("He needs you: the caller that broke."), false);
});

test("asksQuestion finds a question in a short reply that arrives as one line", () => {
  assert.equal(sb.asksQuestion("Both tests pass. Should I push the branch? [confidence: 8/10 — ran the suite]"), true);
  assert.equal(sb.asksQuestion("Should I push the branch? **[confidence: 8/10]**"), true);
  assert.equal(sb.asksQuestion("Both tests pass. Pushed the branch. [confidence: 8/10 — ran the suite]"), false);
});

test("a reply cut short by cmux shows as waiting only when it starts with the marker", () => {
  const cut = "## What changed - Retries now back off. - The test covers three attempts. ## Options 1. Extend the existing ta…";
  const r = rows([
    ws("w1", { directory: "/r/a", latestMessage: "Needs you: which table? " + cut, agents: [agent("a1", "idle")] }),
    ws("w2", { directory: "/r/b", latestMessage: cut, agents: [agent("b1", "idle")] }),
  ]);
  assert.equal(group(r, "a:w1:a1").status, "needs_input");
  assert.equal(group(r, "a:w2:b1").status, "idle");
});

test("an idle agent whose workspace's last message asks a question is waiting on you", () => {
  const r = rows([ws("w1", {
    directory: "/r/app", latestMessage: "Should I push the branch?",
    agents: [agent("a1", "idle")],
  })]);
  assert.equal(group(r, "a:w1:a1").status, "needs_input");
  assert.equal(group(r, "a:w1:a1").agent.status, "idle");
  assert.equal(group(r, "g:/r/app").waiting, 1);
});

test("an idle agent stays done when the last message asks nothing or is missing", () => {
  const r = rows([
    ws("w1", { directory: "/r/a", latestMessage: "Pushed.", agents: [agent("a1", "idle")] }),
    ws("w2", { directory: "/r/b", agents: [agent("b1", "idle")] }),
  ]);
  assert.equal(group(r, "a:w1:a1").status, "idle");
  assert.equal(group(r, "a:w2:b1").status, "idle");
  assert.equal(group(r, "g:/r/a").waiting, 0);
});

test("a question belongs to the workspace's most recently active agent only", () => {
  const r = rows([ws("w1", {
    directory: "/r/app", latestMessage: "Should I push the branch?",
    agents: [agent("old", "idle", { lastActivityAt: 900 }), agent("new", "idle", { lastActivityAt: 990 })],
  })]);
  assert.equal(group(r, "a:w1:new").status, "needs_input");
  assert.equal(group(r, "a:w1:old").status, "idle");
});

test("agents tied on last activity: the first one cmux lists gets the question", () => {
  const r = rows([ws("w1", {
    directory: "/r/app", latestMessage: "Should I push the branch?",
    agents: [agent("first", "idle"), agent("second", "idle")],
  })]);
  assert.equal(group(r, "a:w1:first").status, "needs_input");
  assert.equal(group(r, "a:w1:second").status, "idle");
});

test("a question is not pinned on an agent that is running or ended", () => {
  const message = "Should I push the branch?";
  const r = rows([
    ws("w1", {
      directory: "/r/a", latestMessage: message,
      agents: [agent("idle", "idle", { lastActivityAt: 900 }), agent("busy", "working", { lastActivityAt: 990 })],
    }),
    ws("w2", { directory: "/r/b", latestMessage: message, agents: [agent("gone", "ended", { lastActivityAt: 990 })] }),
  ]);
  assert.equal(group(r, "a:w1:idle").status, "idle");
  assert.equal(group(r, "a:w1:busy").status, "working");
  assert.equal(group(r, "a:w2:gone").status, "ended");
});
