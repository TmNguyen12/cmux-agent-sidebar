// agents: worktrees, repos and folders, each with its coding agents and their
// live status. Meant as the left pane, in place of the workspace list.
//
// Reads only cmux's own sidebar data (data.workspaces, data.clock). cmux learns
// agent state from its bundled claude/codex wrapper, so this sidebar needs no
// hooks, scripts or network access. See docs/design.md and SECURITY.md.
//
//   cp sidebars/agents.js ~/.config/cmux/sidebars/agents.js
//   cmux sidebar select agents

// ── model ────────────────────────────────────────────────────────────────────
// Pure functions over data.workspaces(); tests/model.test.mjs covers them.

// Ended sessions stay visible briefly (a just-finished agent is still news).
const ENDED_VISIBLE_SECS = 15 * 60;

// cmux asks sidebars to cap long lists: a render over the runtime's budget is
// discarded and the last good one stays up, which would freeze stale statuses.
const MAX_ROWS = 200;

// Every status is a dot; color alone tells them apart. Catppuccin Mocha:
// Peach, Blue, Green, Overlay0.
const STATUS = {
  needs_input: { mark: "●", label: "waiting on you", color: "#fab387" },
  working: { mark: "●", label: "running", color: "#89b4fa" },
  idle: { mark: "●", label: "done", color: "#a6e3a1" },
  ended: { mark: "○", label: "ended", color: "#6c7086" },
};

function statusMeta(status) {
  if (Object.hasOwn(STATUS, status)) return STATUS[status];
  return { mark: "○", label: String(status), color: "#6c7086" };
}

// An agent that ends its turn on a question is idle to cmux, yet it is waiting
// on you. In a reply short enough to arrive whole, the question sits near the
// end, often above a list of options, so list lines are read without using up
// the prose lines.
const QUESTION_PROSE_LINES = 3;
const QUESTION_MAX_LINES = 40;
// Only the end of a long message is read, to stay inside the render budget.
const QUESTION_TAIL_CHARS = 4000;
// A line ending in a question mark, allowing closing markdown, quotes or brackets.
const ENDS_IN_QUESTION = /[?？][\s*_`"')\]”’]*$/;
// A bullet (- * + •) or a numbered item (1. or 1)).
const LIST_ITEM = /^(?:[-*+•]|\d+[.)])\s/;
// The author's agents close a reply with "[confidence: N/10 …]" and must stop
// and ask below 7, so a low score counts as a question with no question mark.
const CONFIDENCE = /\[confidence:\s*(\d+(?:\.\d+)?)\s*\/\s*10\b/i;
const CONFIDENCE_ASKS_BELOW = 7;
// cmux passes only the start of the last message, 240 characters, so the
// end of a long reply never arrives. The author's agents start a reply that
// waits on an answer with "Needs you:", allowing markdown around it.
const ASK_MARKER = /^[\s*_`#>]*needs you[*_`]*:/i;
const TRAILING_MARKDOWN = /[\s*_`]+$/;

function asksQuestion(message) {
  const text = String(message ?? "");
  if (ASK_MARKER.test(text)) return true;
  const lines = text.slice(-QUESTION_TAIL_CHARS)
    .split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const stop = Math.max(0, lines.length - QUESTION_MAX_LINES);
  let prose = 0;
  for (let i = lines.length - 1; i >= stop; i--) {
    let line = lines[i];
    const score = CONFIDENCE.exec(line);
    if (score) {
      if (Number(score[1]) < CONFIDENCE_ASKS_BELOW) return true;
      // A short reply can arrive as one line, with the score after the question.
      line = line.slice(0, score.index).replace(TRAILING_MARKDOWN, "");
      if (line.length === 0) continue;
    }
    if (ENDS_IN_QUESTION.test(line)) return true;
    if (!LIST_ITEM.test(line) && ++prose >= QUESTION_PROSE_LINES) return false;
  }
  return false;
}

// cmux gives the last message per workspace, not per agent, so it is read as
// the message of the workspace's most recently active agent. An older agent's
// question is lost once another agent in that workspace speaks.
function askingAgentId(w) {
  const agents = w.agents ?? [];
  if (agents.length === 0) return undefined;
  const latest = agents.reduce((x, y) => ((y.lastActivityAt ?? 0) > (x.lastActivityAt ?? 0) ? y : x));
  return latest.status === "idle" && asksQuestion(w.latestMessage) ? latest.id : undefined;
}

const KIND_SYMBOLS = { claude: "✻", codex: "◆" };
// Claude in its clay brand color; Codex in the plain text color.
const KIND_COLORS = { claude: "#D97757", codex: "primary" };

function kindSymbol(kind) {
  if (Object.hasOwn(KIND_SYMBOLS, kind)) return KIND_SYMBOLS[kind];
  return kind ? String(kind)[0].toUpperCase() : "?";
}

function kindColor(kind) {
  return Object.hasOwn(KIND_COLORS, kind) ? KIND_COLORS[kind] : "secondary";
}

function segments(path) {
  return String(path ?? "").split("/").filter((p) => p.length > 0);
}

// "/r/app/" and "/r/app" are one folder; an empty path is no path.
function normPath(path) {
  if (!path) return undefined;
  return String(path).replace(/\/+$/, "") || "/";
}

// A checkout's subfolder reports the checkout's branch too. A _ or . folder
// (_claude, .dotfiles) is assumed to be such a subfolder, never a repo of its own.
function hiddenName(name) {
  return /^[_.]/.test(name);
}

// A worktree, from the folder layout since the sidebar can't ask git:
// <parent>/worktrees/<repo>/<wt> beside its repo, or <repo>/.claude/worktrees/<wt>
// where Claude Code's EnterWorktree puts it. An agent that cds into a
// subfolder keeps that folder, so the worktree is the first folder after
// <repo> or .claude/worktrees. A worktree named with a slash
// (worktrees/<repo>/codex/x) shows as its first folder.
function worktreeOf(path) {
  const parts = segments(path);
  const i = parts.lastIndexOf("worktrees");
  const at = (repo, name) => ({
    root: "/" + parts.slice(0, name + 1).join("/"), repo: "/" + repo.join("/"),
    repoName: repo[repo.length - 1], name: parts[name],
  });
  if (i > 0 && parts[i - 1] === ".claude" && i < parts.length - 1) return at(parts.slice(0, i - 1), i + 1);
  if (i >= 0 && i < parts.length - 2) return at([...parts.slice(0, i), parts[i + 1]], i + 2);
  return undefined;
}

// A worktree, else a git checkout (branch known), else a plain folder. A
// worktree is named by its folder: cmux reports a tab's branch only at a shell
// prompt, so an agent that moved into the worktree still carries the branch of
// the folder it started in.
function groupLabel(path, branch) {
  const wt = worktreeOf(path);
  if (wt) return { groupKind: "worktree", label: wt.repoName + " / " + wt.name };
  const parts = segments(path);
  const name = parts.length ? parts[parts.length - 1] : path;
  if (branch !== undefined && !hiddenName(name)) return { groupKind: "repo", label: name + " · " + branch };
  return { groupKind: "folder", label: name };
}

// The repo a checkout belongs to: a worktree's repo, else the checkout itself.
function repoOf(path, branch) {
  const wt = worktreeOf(path);
  if (wt) return { path: wt.repo, name: wt.repoName, checkout: wt.name, main: false };
  const parts = segments(path);
  if (branch === undefined || parts.length === 0 || hiddenName(parts[parts.length - 1])) return undefined;
  return { path: "/" + parts.join("/"), name: parts[parts.length - 1], checkout: branch, main: true };
}

function worktreeRoot(path) {
  return worktreeOf(path)?.root ?? path;
}

// Claude Code names its terminal tab after the conversation, and a tab you
// rename in cmux keeps your name, so the tab title tells sessions apart. A tab
// still titled with a path or the agent's own name says nothing; use the first
// prompt instead.
function agentTitle(agent, tab, dir) {
  const t = String(tab?.title ?? "").trim();
  const generic = !t || t.startsWith("/") || t.startsWith("~")
    || [agent.kind, agent.name].some((n) => n && t.toLowerCase() === String(n).toLowerCase());
  if (!generic) return t;
  return agent.title || segments(dir).pop() || agent.name || "agent";
}

function visible(agent, epoch) {
  return agent.status !== "ended" || epoch - (agent.lastActivityAt ?? 0) <= ENDED_VISIBLE_SECS;
}

// Flat, keyed row list for one ForEach: a group row per worktree, repo or
// folder, each followed by its agent rows, then its shell rows. Keys encode the
// row kind, so a key's template never changes kind across live updates.
function buildRows(workspaces, epoch) {
  // A workspace sitting in a checkout's subfolder reports the checkout's
  // branch, so it would look like a repo of its own. Fold it into the
  // outermost open checkout that holds it on the same branch. A worktree
  // inside a checkout (.claude/worktrees/<wt>) never folds: its reported
  // branch can be the checkout's, stale from before an agent moved in.
  const holds = (outer, dir) => dir.startsWith(outer + "/")
    && !segments(dir.slice(outer.length)).includes("worktrees");
  const checkouts = workspaces
    .filter((w) => w.branch !== undefined)
    .map((w) => ({ dir: worktreeRoot(normPath(w.directory)), branch: w.branch }))
    .filter((c) => c.dir)
    .sort((a, b) => a.dir.length - b.dir.length);
  const wsRoot = (w) => {
    const dir = worktreeRoot(normPath(w.directory));
    const outer = dir && checkouts.find((c) => c.branch === w.branch && holds(c.dir, dir));
    return outer ? outer.dir : dir;
  };

  // Longest workspace folder first, so an agent in a subfolder lands in the
  // most specific workspace folder that contains it.
  const wsDirs = workspaces
    .map(wsRoot)
    .filter((d) => d)
    .sort((a, b) => b.length - a.length);
  const groupOf = (dir) =>
    wsDirs.find((d) => dir === d || holds(d, dir)) ?? dir;
  const wsCount = new Map();
  for (const d of wsDirs) wsCount.set(d, (wsCount.get(d) ?? 0) + 1);

  const groups = new Map();
  const ensure = (id, init) => {
    let g = groups.get(id);
    if (!g) {
      g = { ...init, agents: [], shells: [] };
      if (init.owner) g.ownerOrder = init.order;
      groups.set(id, g);
    }
    if (g.branch === undefined && init.branch !== undefined) {
      g.branch = init.branch;
      g.dirty = init.dirty;
    }
    // A group row switches to the workspace that owns the folder, preferring
    // the selected one, not whichever agent was seen first.
    if (init.owner && (!g.owner || init.selected)) {
      g.wsId = init.wsId;
      g.owner = true;
      g.ownerOrder = init.order;
    }
    g.order = Math.min(g.order, init.order);
    g.selected = g.selected || init.selected;
    return g;
  };
  const folderless = (w, order) =>
    ensure("ws:" + w.id, {
      key: "g:ws:" + w.id, title: w.title, wsId: w.id, owner: true, selected: w.selected, order,
    });

  workspaces.forEach((w, position) => {
    const order = w.index ?? position;
    const wsDir = wsRoot(w);
    // A folded workspace takes its checkout's row only while selected, like a
    // second workspace on that folder. Branch and dirty state stay the
    // checkout's own workspace's.
    const owns = wsDir === worktreeRoot(normPath(w.directory));
    const agents = (w.agents ?? []).filter((a) => visible(a, epoch));
    const asking = askingAgentId(w);
    if (wsDir) {
      const home = ensure(wsDir, {
        key: "g:" + wsDir, path: wsDir,
        branch: owns ? w.branch : undefined, dirty: owns ? w.dirty : undefined,
        wsId: w.id, owner: owns || w.selected === true, selected: w.selected, order,
      });
      // A folder's group row selects only one of its workspaces, so on a shared
      // folder a workspace with no agent rows would be unreachable without one.
      if (agents.length === 0 && wsCount.get(wsDir) > 1) {
        home.shells.push({ wsId: w.id, title: w.title || "shell", order, focused: w.selected === true });
      }
    }
    for (const a of agents) {
      const tabs = w.tabs ?? [];
      const tabIndex = tabs.findIndex((t) => t.id === a.panelId);
      const tab = tabs[tabIndex];
      const dir = worktreeRoot(normPath(a.directory)) ?? wsDir;
      const entry = {
        wsId: w.id, agent: a, title: agentTitle(a, tab, dir), order, tabIndex,
        status: a.id === asking ? "needs_input" : a.status,
        focused: w.selected === true && tab?.focused === true,
        // ⌃1…⌃9 pick a tab after ⌘N picks the workspace. The sidebar data has
        // no split panes, so this assumes the workspace has none. A lone tab
        // gets no key; there is nothing to pick between.
        tabKey: tabs.length > 1 && tabIndex >= 0 && tabIndex < 9 ? "⌃" + (tabIndex + 1) : "",
      };
      if (!dir) {
        folderless(w, order).agents.push(entry);
        continue;
      }
      const path = groupOf(dir);
      const own = owns && path === wsDir;
      ensure(path, {
        key: "g:" + path, path,
        branch: tab?.branch ?? (own ? w.branch : undefined),
        dirty: tab?.dirty ?? (own ? w.dirty : undefined),
        wsId: w.id, owner: own, selected: own && w.selected, order,
      }).agents.push(entry);
    }
    if (!wsDir && agents.length === 0) folderless(w, order);
  });

  const out = [];
  // Rows keep their place as focus and status change: cmux moves a
  // workspace's folder to its focused tab, so groups in one workspace sort by
  // folder, and agents sort by tab, not by status.
  const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const wsKey = (order) => (order < 9 ? "⌘" + (order + 1) : "");
  const ordered = [...groups.values()].sort((a, b) => a.order - b.order || byKey(a.key, b.key));

  // Checkouts of one repo sit under one repo row. A folder with no known
  // branch joins a repo only when it is that repo's main checkout.
  const repos = new Map();
  for (const g of ordered) {
    const r = g.path === undefined ? undefined : repoOf(g.path, g.branch);
    if (r) repos.set(g, r);
  }
  const repoPaths = new Set([...repos.values()].map((r) => r.path));
  for (const g of ordered) {
    if (g.path === undefined || repos.has(g) || !repoPaths.has(g.path)) continue;
    const name = segments(g.path).pop();
    repos.set(g, { path: g.path, name, checkout: name, main: true });
  }

  // Every group sits under a repo or the Folders header.
  const labelOf = (g) => (g.path === undefined
    ? { groupKind: "folder", label: g.title || "untitled" }
    : groupLabel(g.path, g.branch));

  const emitGroup = (g, checkout) => {
    const { groupKind, label } = labelOf(g);
    const tabOrder = (e) => (e.tabIndex < 0 ? Infinity : e.tabIndex);
    g.agents.sort((x, y) =>
      (x.order - y.order) || (tabOrder(x) - tabOrder(y)) || byKey(String(x.agent.id), String(y.agent.id)));
    // ⌘1…⌘9 select workspaces, so a group shows its workspace's key. A group
    // that is only an agent's folder shows the key of the workspace hosting it.
    const shortcut = wsKey(g.owner ? g.ownerOrder : g.order);
    out.push({
      key: g.key, kind: "group", groupKind, label: checkout ?? label, shortcut, nested: true,
      // The dirty flag goes stale the same way as the branch.
      dirty: groupKind !== "worktree" && g.dirty === true, wsId: g.wsId, selected: g.selected === true,
      working: g.agents.filter((e) => e.status === "working").length,
      waiting: g.agents.filter((e) => e.status === "needs_input").length,
      total: g.agents.length,
    });
    for (const { wsId, agent, status, title, focused, tabKey } of g.agents) {
      out.push({
        key: "a:" + wsId + ":" + agent.id, kind: "agent", wsId, agent, status, title, focused, tabKey,
        symbol: kindSymbol(agent.kind),
        subagents: (agent.children ?? []).filter((c) => c.running).length,
      });
    }
    g.shells.sort((x, y) => x.order - y.order);
    for (const { wsId, title, order, focused } of g.shells) {
      out.push({ key: "s:" + wsId, kind: "shell", wsId, title, shortcut: wsKey(order), focused });
    }
  };

  // Repos first, then plain folders and folderless workspaces under one
  // Folders header. Each sorts by name, main checkout first: cmux can move a
  // workspace to the top (iMessage mode, on every prompt), so workspace order
  // would shuffle them.
  const byName = (a, b) => byKey(a.toLowerCase(), b.toLowerCase()) || byKey(a, b);
  const repoList = [...new Map([...repos.values()].map((r) => [r.path, r])).values()]
    .sort((a, b) => byName(a.name, b.name) || byKey(a.path, b.path));
  for (const r of repoList) {
    out.push({ key: "r:" + r.path, kind: "repo", label: r.name });
    const checkouts = ordered.filter((h) => repos.get(h)?.path === r.path)
      .sort((a, b) => repos.get(b).main - repos.get(a).main
        || byName(repos.get(a).checkout, repos.get(b).checkout) || byKey(a.key, b.key));
    for (const h of checkouts) emitGroup(h, repos.get(h).checkout);
  }
  const folders = ordered.filter((g) => !repos.has(g))
    .sort((a, b) => byName(labelOf(a).label, labelOf(b).label) || byKey(a.key, b.key));
  if (folders.length) out.push({ key: "r:folders", kind: "repo", label: "Folders" });
  for (const g of folders) emitGroup(g);
  if (out.length > MAX_ROWS) {
    return [...out.slice(0, MAX_ROWS), { key: "m:rows", kind: "more", text: "+" + (out.length - MAX_ROWS) + " more" }];
  }
  return out;
}

// ── view ─────────────────────────────────────────────────────────────────────
// One line per row, and only the time column keeps its natural width, so the
// sidebar can be dragged narrow without wrapping.

// Highlights use Catppuccin Mocha (https://catppuccin.com/palette). Mocha is a
// dark theme; these read poorly on a light window.
// Highlights sink into Crust, Mocha's darkest shade, so the selected card
// reads as pressed in rather than lit up. A faint Lavender hairline edges it.
const MOCHA = {
  cardFill: "#11111bb3", // Crust 70%
  cardOutline: "#b4befe40", // Lavender 25%
  focusFill: "#11111b", // Crust
  hoverFill: "#11111b66", // Crust 40%
  dirty: "#f9e2af", // Yellow
};
const CARD_RADIUS = 6;
// Every text size in the sidebar, so raising these scales it as a whole.
const FONT = { xs: 12, sm: 13, md: 14, lg: 15 };

function fmtElapsed(secs) {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m " + String(s % 60).padStart(2, "0") + "s";
  return Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m";
}

function fmtAgo(secs) {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

const epochNow = () => data.clock()?.epoch ?? 0;
const live = (a) => a.status === "working" || a.status === "needs_input";

// Running or waiting: live elapsed in that state. Done: how long ago it
// finished, said as "ago" so the two never read alike.
function agentTime(a, epoch) {
  if (live(a) && a.sinceEpoch) return fmtElapsed(epoch - a.sinceEpoch);
  if (a.lastActivityAt) return fmtAgo(epoch - a.lastActivityAt) + " ago";
  return "";
}

function focusAgent(row) {
  cmux("workspace.select", { workspace_id: row.wsId });
  if (row.agent.surfaceId) cmux("surface.focus", { surface_id: row.agent.surfaceId, workspace_id: row.wsId });
}

const rows = computed(() => buildRows(data.workspaces() ?? [], epochNow()));

const counts = computed(() => {
  const c = { working: 0, waiting: 0 };
  for (const r of rows()) {
    if (r.kind !== "group") continue;
    c.working += r.working;
    c.waiting += r.waiting;
  }
  return c;
});

function headerRow() {
  return HStack({ spacing: 6 }, [
    Text("Agents").font(FONT.lg).weight("semibold").lineLimit(1),
    Spacer(),
    Text(() => (counts().waiting > 0 ? "● " + counts().waiting : ""))
      .font(FONT.sm).monospaced().color(STATUS.needs_input.color).lineLimit(1).fixedSize(),
    Text(() => (counts().working > 0 ? "● " + counts().working : ""))
      .font(FONT.sm).monospaced().color(STATUS.working.color).lineLimit(1).fixedSize(),
  ]).paddingHorizontal(8);
}

function groupRow(row) {
  return HStack({ spacing: 5 }, [
    // Leading, so the key sits by the name and never reads as a time.
    Text(() => row().shortcut).font(FONT.md).monospaced().color("tertiary").lineLimit(1).fixedSize(),
    Image(() => (row().groupKind === "folder" ? "folder" : "arrow.triangle.branch"))
      .font(FONT.xs).color("tertiary"),
    Text(() => row().label)
      .font(FONT.md).weight("semibold").lineLimit(1).truncation("middle")
      .color(() => (row().selected ? "primary" : "secondary")),
    Text(() => (row().dirty ? "✱" : "")).font(FONT.xs).color(MOCHA.dirty).fixedSize(),
    Spacer(),
  ])
    .paddingHorizontal(8).paddingVertical(3)
    .cornerRadius(CARD_RADIUS - 2)
    .hoverBackground(MOCHA.hoverFill)
    .cursor("pointer")
    .frame({ maxWidth: "infinity" })
    .onTap(() => cmux("workspace.select", { workspace_id: row().wsId }));
}

function agentRow(row) {
  const a = () => row().agent;
  return HStack({ spacing: 5 }, [
    Text(() => row().tabKey).font(FONT.md).monospaced().color("tertiary").lineLimit(1).fixedSize(),
    Text(() => statusMeta(row().status).mark)
      .font(FONT.xs).color(() => statusMeta(row().status).color).fixedSize(),
    Text(() => row().symbol).font(FONT.md).weight("bold").color(() => kindColor(row().agent.kind)).fixedSize(),
    Text(() => row().title)
      .font(FONT.sm).lineLimit(1).truncation("tail")
      .color(() => (a().status === "ended" ? "tertiary" : "primary")),
    Text(() => (row().subagents > 0 ? "↳" + row().subagents : ""))
      .font(FONT.xs).monospaced().color(STATUS.working.color).fixedSize(),
    Spacer(),
    Text(() => agentTime(a(), epochNow()))
      .font(FONT.xs).monospaced().color("tertiary").lineLimit(1).fixedSize().layoutPriority(2),
  ])
    .paddingLeading(18).paddingTrailing(8).paddingVertical(2)
    .cornerRadius(CARD_RADIUS - 2)
    .background(() => (row().focused ? MOCHA.focusFill : null))
    .hoverBackground(MOCHA.hoverFill)
    .cursor("pointer")
    .frame({ maxWidth: "infinity" })
    .onTap(() => focusAgent(row()));
}

// Same insets as an agent row, so the key and title columns line up.
function shellRow(row) {
  return HStack({ spacing: 5 }, [
    Text(() => row().shortcut).font(FONT.md).monospaced().color("tertiary").lineLimit(1).fixedSize(),
    Image("terminal").font(FONT.xs).color("tertiary"),
    Text(() => row().title).font(FONT.sm).lineLimit(1).truncation("tail").color("secondary"),
    Spacer(),
  ])
    .paddingLeading(18).paddingTrailing(8).paddingVertical(2)
    .cornerRadius(CARD_RADIUS - 2)
    .background(() => (row().focused ? MOCHA.focusFill : null))
    .hoverBackground(MOCHA.hoverFill)
    .cursor("pointer")
    .frame({ maxWidth: "infinity" })
    .onTap(() => cmux("workspace.select", { workspace_id: row().wsId }));
}

const CARD_ROW_VIEWS = { agent: agentRow, shell: shellRow };

// A section label over the repo's checkouts, with no icon, so it reads apart
// from the checkout rows; each checkout row selects its workspace.
function repoRow(card) {
  return HStack({ spacing: 5 }, [
    Text(() => card().label.toUpperCase())
      .font(FONT.xs).weight("semibold").lineLimit(1).truncation("middle").color("tertiary"),
    Spacer(),
  ])
    .paddingHorizontal(11).paddingVertical(2)
    .frame({ maxWidth: "infinity" });
}

function moreRow(row) {
  return Text(() => row().text)
    .font(FONT.xs).color("tertiary").lineLimit(1)
    .paddingHorizontal(8).paddingVertical(2)
    .frame({ maxWidth: "infinity" });
}

// Fold the flat rows into one card per group, so the selected workspace's
// group can be outlined as a whole. A trailing "more" row passes through.
function toCards(flat) {
  const cards = [];
  // A divider before each repo or flat group but the first, keyed by the
  // section it opens so it keeps its identity across updates.
  const divide = (key) => {
    if (cards.length) cards.push({ key: "d:" + key, kind: "divider" });
  };
  for (const r of flat) {
    if (r.kind === "repo" || (r.kind === "group" && !r.nested)) divide(r.key);
    if (r.kind === "repo") cards.push({ key: r.key, kind: "repo", label: r.label });
    else if (r.kind === "group" && r.nested) cards.push({ key: "n:" + r.key, kind: "nestedCard", group: r, rows: [] });
    else if (r.kind === "group") cards.push({ key: r.key, kind: "card", group: r, rows: [] });
    else if (Object.hasOwn(CARD_ROW_VIEWS, r.kind) && cards.length) cards[cards.length - 1].rows.push(r);
    else if (r.kind === "more") cards.push(r);
  }
  return cards;
}

const cards = computed(() => toCards(rows()));

// The runtime has no shadow, so the selected card is raised with a lighter
// fill and a hairline outline instead.
function cardView(card, indent = 0) {
  const selected = () => card().group.selected;
  return VStack({ spacing: 1 }, [
    groupRow(() => card().group),
    ForEach({ items: () => card().rows, key: (r) => r.key }, (r) => CARD_ROW_VIEWS[r().kind](r)),
  ])
    .padding(3)
    .cornerRadius(CARD_RADIUS)
    .background(() => (selected() ? MOCHA.cardFill : null))
    .borderColor(() => (selected() ? MOCHA.cardOutline : "clear"))
    .borderWidth(1)
    .frame({ maxWidth: "infinity" })
    .paddingLeading(indent);
}

const CARD_VIEWS = {
  divider: () => Divider().paddingHorizontal(8),
  repo: repoRow,
  card: (c) => cardView(c),
  nestedCard: (c) => cardView(c, 12),
  more: moreRow,
};

sidebar(() =>
  VStack({ spacing: 4 }, [
    headerRow(),
    Divider(),
    ForEach({ items: cards, key: (c) => c.key }, (c) => CARD_VIEWS[c().kind](c)),
    Text(() => (rows().length === 0
      ? "No workspaces yet. Agents started in cmux terminals show up here."
      : ""))
      .font(FONT.sm).color("tertiary").paddingHorizontal(8),
    Spacer(),
  ]).paddingHorizontal(4).paddingVertical(8),
  { surface: "glass" },
);
