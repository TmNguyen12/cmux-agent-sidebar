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
  needs_input: { mark: "●", label: "waiting on you", color: "#fab387", rank: 0 },
  working: { mark: "●", label: "running", color: "#89b4fa", rank: 1 },
  idle: { mark: "●", label: "done", color: "#a6e3a1", rank: 2 },
  ended: { mark: "○", label: "ended", color: "#6c7086", rank: 3 },
};

function statusMeta(status) {
  if (Object.hasOwn(STATUS, status)) return STATUS[status];
  return { mark: "○", label: String(status), color: "#6c7086", rank: 9 };
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

// A worktree (…/worktrees/<repo>/<rest>), else a git checkout (branch known),
// else a plain folder.
function groupLabel(path, branch) {
  const parts = segments(path);
  const i = parts.lastIndexOf("worktrees");
  if (i >= 0 && i < parts.length - 2) {
    return { groupKind: "worktree", label: parts[i + 1] + " / " + (branch ?? parts.slice(i + 2).join("/")) };
  }
  const name = parts.length ? parts[parts.length - 1] : path;
  if (branch !== undefined) return { groupKind: "repo", label: name + " · " + branch };
  return { groupKind: "folder", label: name };
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
  // Longest workspace folder first, so an agent in a subfolder lands in the
  // most specific workspace folder that contains it.
  const wsDirs = workspaces
    .map((w) => normPath(w.directory))
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
    const wsDir = normPath(w.directory);
    const agents = (w.agents ?? []).filter((a) => visible(a, epoch));
    if (wsDir) {
      ensure(wsDir, {
        key: "g:" + wsDir, path: wsDir, branch: w.branch, dirty: w.dirty,
        wsId: w.id, owner: true, selected: w.selected, order,
      });
    }
    for (const a of agents) {
      const tab = (w.tabs ?? []).find((t) => t.id === a.panelId);
      const dir = normPath(a.directory) ?? wsDir;
      const entry = {
        wsId: w.id, agent: a, title: agentTitle(a, tab, dir),
        focused: w.selected === true && tab?.focused === true,
      };
      if (!dir) {
        folderless(w, order).agents.push(entry);
        continue;
      }
      const path = groupOf(dir);
      const own = path === wsDir;
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
  const ordered = [...groups.values()].sort((a, b) => a.order - b.order);
  for (const g of ordered) {
    const { groupKind, label } = g.path === undefined
      ? { groupKind: "folder", label: g.title || "untitled" }
      : groupLabel(g.path, g.branch);
    g.agents.sort((x, y) =>
      (statusMeta(x.agent.status).rank - statusMeta(y.agent.status).rank)
      || ((y.agent.lastActivityAt ?? 0) - (x.agent.lastActivityAt ?? 0)));
    // ⌘1…⌘9 select workspaces, so a group shows its workspace's key. A group
    // that is only an agent's folder shows the key of the workspace hosting it.
    const shortcut = g.owner
      ? (g.ownerOrder < 9 ? "⌘" + (g.ownerOrder + 1) : "")
      : (g.order < 9 ? "in ⌘" + (g.order + 1) : "");
    out.push({
      key: g.key, kind: "group", groupKind, label, shortcut,
      dirty: g.dirty === true, wsId: g.wsId, selected: g.selected === true,
      working: g.agents.filter((e) => e.agent.status === "working").length,
      waiting: g.agents.filter((e) => e.agent.status === "needs_input").length,
      total: g.agents.length,
    });
    for (const { wsId, agent, title, focused } of g.agents) {
      out.push({
        key: "a:" + wsId + ":" + agent.id, kind: "agent", wsId, agent, title, focused,
        symbol: kindSymbol(agent.kind),
        subagents: (agent.children ?? []).filter((c) => c.running).length,
      });
    }
  }
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
const MOCHA = {
  cardFill: "#313244cc", // Surface0
  cardOutline: "#b4befe59", // Lavender
  focusFill: "#45475acc", // Surface1
  hoverFill: "#45475a80", // Surface1
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
  for (const r of flat) {
    if (r.kind === "group") cards.push({ key: r.key, kind: "card", group: r, agents: [] });
    else if (r.kind === "agent" && cards.length) cards[cards.length - 1].agents.push(r);
    else if (r.kind === "more") cards.push(r);
  }
  return cards;
}

const cards = computed(() => toCards(rows()));

// The runtime has no shadow, so the selected card is raised with a lighter
// fill and a hairline outline instead.
function cardView(card) {
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
    .frame({ maxWidth: "infinity" });
}

const CARD_VIEWS = { card: cardView, more: moreRow };

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
