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
// (_claude, .github) is assumed to be such a subfolder, never a repo of its own.
function hiddenName(name) {
  return /^[_.]/.test(name);
}

// A worktree (…/worktrees/<repo>/<rest>), else a git checkout (branch known),
// else a plain folder. A worktree is named by its folder: cmux reports a tab's
// branch only at a shell prompt, so an agent that moved into the worktree
// still carries the branch of the folder it started in.
function groupLabel(path, branch) {
  const parts = segments(path);
  const i = parts.lastIndexOf("worktrees");
  if (i >= 0 && i < parts.length - 2) {
    return { groupKind: "worktree", label: parts[i + 1] + " / " + parts[i + 2] };
  }
  const name = parts.length ? parts[parts.length - 1] : path;
  if (branch !== undefined && !hiddenName(name)) return { groupKind: "repo", label: name + " · " + branch };
  return { groupKind: "folder", label: name };
}

// The repo a checkout belongs to, from the folder layout: <parent>/<repo> and
// <parent>/worktrees/<repo>/<rest> are one repo. The sidebar can't ask git.
function repoOf(path, branch) {
  const parts = segments(path);
  const i = parts.lastIndexOf("worktrees");
  if (i >= 0 && i < parts.length - 2) {
    return {
      path: "/" + [...parts.slice(0, i), parts[i + 1]].join("/"),
      name: parts[i + 1], checkout: parts[i + 2], main: false,
    };
  }
  if (branch === undefined || parts.length === 0 || hiddenName(parts[parts.length - 1])) return undefined;
  return { path: "/" + parts.join("/"), name: parts[parts.length - 1], checkout: branch, main: true };
}

// An agent that cds into a subfolder keeps that folder, so a worktree is
// …/worktrees/<repo>/<first folder>. A worktree named with a slash
// (worktrees/<repo>/codex/x) shows as its first folder.
function worktreeRoot(path) {
  const parts = segments(path);
  const i = parts.lastIndexOf("worktrees");
  if (i < 0 || i >= parts.length - 3) return path;
  return "/" + parts.slice(0, i + 3).join("/");
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
// folder, each followed by its agent rows. Keys encode the row kind, so a key's
// template never changes kind across live updates.
function buildRows(workspaces, epoch) {
  // A workspace sitting in a checkout's subfolder reports the checkout's
  // branch, so it would look like a repo of its own. Fold it into the
  // outermost open checkout that holds it on the same branch. Git won't check
  // out one branch twice, so a worktree inside a checkout never matches.
  const checkouts = workspaces
    .filter((w) => w.branch !== undefined)
    .map((w) => ({ dir: worktreeRoot(normPath(w.directory)), branch: w.branch }))
    .filter((c) => c.dir)
    .sort((a, b) => a.dir.length - b.dir.length);
  const wsRoot = (w) => {
    const dir = worktreeRoot(normPath(w.directory));
    const outer = dir && checkouts.find((c) => c.branch === w.branch && dir.startsWith(c.dir + "/"));
    return outer ? outer.dir : dir;
  };

  // Longest workspace folder first, so an agent in a subfolder lands in the
  // most specific workspace folder that contains it.
  const wsDirs = workspaces
    .map(wsRoot)
    .filter((d) => d)
    .sort((a, b) => b.length - a.length);
  const groupOf = (dir) =>
    wsDirs.find((d) => dir === d || dir.startsWith(d + "/")) ?? dir;

  const groups = new Map();
  const ensure = (id, init) => {
    let g = groups.get(id);
    if (!g) {
      g = { ...init, agents: [] };
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
    // A folded workspace joins its checkout's group the way an agent's folder
    // does: the checkout's own workspace keeps the row, branch and dirty state.
    const owns = wsDir === worktreeRoot(normPath(w.directory));
    const agents = (w.agents ?? []).filter((a) => visible(a, epoch));
    if (wsDir) {
      ensure(wsDir, {
        key: "g:" + wsDir, path: wsDir,
        branch: owns ? w.branch : undefined, dirty: owns ? w.dirty : undefined,
        wsId: w.id, owner: owns, selected: owns && w.selected, order,
      });
    }
    for (const a of agents) {
      const tabs = w.tabs ?? [];
      const tabIndex = tabs.findIndex((t) => t.id === a.panelId);
      const tab = tabs[tabIndex];
      const dir = worktreeRoot(normPath(a.directory)) ?? wsDir;
      const entry = {
        wsId: w.id, agent: a, title: agentTitle(a, tab, dir), order, tabIndex,
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
  const ordered = [...groups.values()].sort((a, b) => a.order - b.order || byKey(a.key, b.key));

  // Checkouts of one repo sit under a repo row placed at the repo's first
  // checkout, main checkout first. A folder with no known branch joins a repo
  // only when it is that repo's main checkout.
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

  const emitGroup = (g, checkout) => {
    // Every group sits under a repo or the Folders header.
    const { groupKind, label } = g.path === undefined
      ? { groupKind: "folder", label: g.title || "untitled" }
      : groupLabel(g.path, g.branch);
    const tabOrder = (e) => (e.tabIndex < 0 ? Infinity : e.tabIndex);
    g.agents.sort((x, y) =>
      (x.order - y.order) || (tabOrder(x) - tabOrder(y)) || byKey(String(x.agent.id), String(y.agent.id)));
    // ⌘1…⌘9 select workspaces, so a group shows its workspace's key. A group
    // that is only an agent's folder shows the key of the workspace hosting it.
    const n = g.owner ? g.ownerOrder : g.order;
    const shortcut = n < 9 ? "⌘" + (n + 1) : "";
    out.push({
      key: g.key, kind: "group", groupKind, label: checkout ?? label, shortcut, nested: true,
      // The dirty flag goes stale the same way as the branch.
      dirty: groupKind !== "worktree" && g.dirty === true, wsId: g.wsId, selected: g.selected === true,
      working: g.agents.filter((e) => e.agent.status === "working").length,
      waiting: g.agents.filter((e) => e.agent.status === "needs_input").length,
      total: g.agents.length,
    });
    for (const { wsId, agent, title, focused, tabKey } of g.agents) {
      out.push({
        key: "a:" + wsId + ":" + agent.id, kind: "agent", wsId, agent, title, focused, tabKey,
        symbol: kindSymbol(agent.kind),
        subagents: (agent.children ?? []).filter((c) => c.running).length,
      });
    }
  };

  // Repos first, then plain folders and folderless workspaces under one
  // Folders header, each in workspace order.
  const emittedRepos = new Set();
  const folders = [];
  for (const g of ordered) {
    const r = repos.get(g);
    if (!r) {
      folders.push(g);
      continue;
    }
    if (emittedRepos.has(r.path)) continue;
    emittedRepos.add(r.path);
    out.push({ key: "r:" + r.path, kind: "repo", label: r.name });
    const checkouts = ordered.filter((h) => repos.get(h)?.path === r.path)
      .sort((a, b) => repos.get(b).main - repos.get(a).main);
    for (const h of checkouts) emitGroup(h, repos.get(h).checkout);
  }
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
    Text("Agents").font(13).weight("semibold").lineLimit(1),
    Spacer(),
    Text(() => (counts().waiting > 0 ? "● " + counts().waiting : ""))
      .font(11).monospaced().color(STATUS.needs_input.color).lineLimit(1).fixedSize(),
    Text(() => (counts().working > 0 ? "● " + counts().working : ""))
      .font(11).monospaced().color(STATUS.working.color).lineLimit(1).fixedSize(),
  ]).paddingHorizontal(8);
}

function groupRow(row) {
  return HStack({ spacing: 5 }, [
    // Leading, so the key sits by the name and never reads as a time.
    Text(() => row().shortcut).font(10).monospaced().color("tertiary").lineLimit(1).fixedSize(),
    Image(() => (row().groupKind === "folder" ? "folder" : "arrow.triangle.branch"))
      .font(10).color("tertiary"),
    Text(() => row().label)
      .font(12).weight("semibold").lineLimit(1).truncation("middle")
      .color(() => (row().selected ? "primary" : "secondary")),
    Text(() => (row().dirty ? "✱" : "")).font(10).color(MOCHA.dirty).fixedSize(),
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
    Text(() => row().tabKey).font(10).monospaced().color("tertiary").lineLimit(1).fixedSize(),
    Text(() => statusMeta(a().status).mark)
      .font(10).color(() => statusMeta(a().status).color).fixedSize(),
    Text(() => row().symbol).font(12).weight("bold").color(() => kindColor(row().agent.kind)).fixedSize(),
    Text(() => row().title)
      .font(11).lineLimit(1).truncation("tail")
      .color(() => (a().status === "ended" ? "tertiary" : "primary")),
    Text(() => (row().subagents > 0 ? "↳" + row().subagents : ""))
      .font(10).monospaced().color(STATUS.working.color).fixedSize(),
    Spacer(),
    Text(() => agentTime(a(), epochNow()))
      .font(10).monospaced().color("tertiary").lineLimit(1).fixedSize().layoutPriority(2),
  ])
    .paddingLeading(18).paddingTrailing(8).paddingVertical(2)
    .cornerRadius(CARD_RADIUS - 2)
    .background(() => (row().focused ? MOCHA.focusFill : null))
    .hoverBackground(MOCHA.hoverFill)
    .cursor("pointer")
    .frame({ maxWidth: "infinity" })
    .onTap(() => focusAgent(row()));
}

// A section label over the repo's checkouts, with no icon, so it reads apart
// from the checkout rows; each checkout row selects its workspace.
function repoRow(card) {
  return HStack({ spacing: 5 }, [
    Text(() => card().label.toUpperCase())
      .font(10).weight("semibold").lineLimit(1).truncation("middle").color("tertiary"),
    Spacer(),
  ])
    .paddingHorizontal(11).paddingVertical(2)
    .frame({ maxWidth: "infinity" });
}

function moreRow(row) {
  return Text(() => row().text)
    .font(10).color("tertiary").lineLimit(1)
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
    else if (r.kind === "group" && r.nested) cards.push({ key: "n:" + r.key, kind: "nestedCard", group: r, agents: [] });
    else if (r.kind === "group") cards.push({ key: r.key, kind: "card", group: r, agents: [] });
    else if (r.kind === "agent" && cards.length) cards[cards.length - 1].agents.push(r);
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
    ForEach({ items: () => card().agents, key: (r) => r.key }, agentRow),
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
      .font(11).color("tertiary").paddingHorizontal(8),
    Spacer(),
  ]).paddingHorizontal(4).paddingVertical(8),
  { surface: "glass" },
);
