// agents: repo → worktree → coding agents, with live status.
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
const MAX_CHILDREN = 5;
const MAX_ROWS = 200;

const STATUS = {
  needs_input: { glyph: "❓", label: "waiting on you", color: "#FF9F0A", rank: 0 },
  working: { glyph: "⚡", label: "working", color: "#30D158", rank: 1 },
  idle: { glyph: "✓", label: "done", color: "#8E8E93", rank: 2 },
  ended: { glyph: "·", label: "ended", color: "#7f7f7f66", rank: 3 },
};

function statusMeta(status) {
  if (Object.hasOwn(STATUS, status)) return STATUS[status];
  return { glyph: "·", label: String(status), color: "#7f7f7f66", rank: 9 };
}

function segments(path) {
  return String(path ?? "").split("/").filter((p) => p.length > 0);
}

// "/r/app/" and "/r/app" are one folder; an empty path is no path.
function normPath(path) {
  if (!path) return undefined;
  return String(path).replace(/\/+$/, "") || "/";
}

// `<repo>` from …/worktrees/<repo>/<branch>, else the folder name.
function repoOf(path) {
  const parts = segments(path);
  const i = parts.lastIndexOf("worktrees");
  if (i >= 0 && i < parts.length - 1) return parts[i + 1];
  return parts.length ? parts[parts.length - 1] : "Other";
}

function visible(agent, epoch) {
  return agent.status !== "ended" || epoch - (agent.lastActivityAt ?? 0) <= ENDED_VISIBLE_SECS;
}

// Flat, keyed row list for one ForEach: repo headers, worktree rows, agent rows
// and subagent rows, in display order. Keys encode the row kind, so a key's
// template never changes kind across live updates.
function buildRows(workspaces, epoch) {
  // Longest workspace directory first, so an agent in a subfolder lands on
  // the most specific worktree that contains it.
  const wsDirs = workspaces
    .map((w) => normPath(w.directory))
    .filter((d) => d)
    .sort((a, b) => b.length - a.length);
  const worktreeOf = (dir) =>
    wsDirs.find((d) => dir === d || dir.startsWith(d + "/")) ?? dir;

  const trees = new Map();
  const ensure = (id, init) => {
    let t = trees.get(id);
    if (!t) {
      t = { ...init, agents: [] };
      trees.set(id, t);
    }
    if (t.branch === undefined && init.branch !== undefined) {
      t.branch = init.branch;
      t.dirty = init.dirty;
    }
    // A worktree row switches to the workspace that owns the folder,
    // preferring the selected one, not whichever agent was seen first.
    if (init.owner && (!t.owner || init.selected)) {
      t.wsId = init.wsId;
      t.owner = true;
    }
    t.selected = t.selected || init.selected;
    return t;
  };
  const folderless = (w) =>
    ensure("ws:" + w.id, {
      key: "t:ws:" + w.id, repo: "Other", title: w.title, wsId: w.id, owner: true, selected: w.selected,
    });

  for (const w of workspaces) {
    const wsDir = normPath(w.directory);
    const agents = (w.agents ?? []).filter((a) => visible(a, epoch));
    if (wsDir) {
      ensure(wsDir, {
        key: "t:" + wsDir, path: wsDir, repo: repoOf(wsDir),
        branch: w.branch, dirty: w.dirty, wsId: w.id, owner: true, selected: w.selected,
      });
    }
    for (const a of agents) {
      const tab = (w.tabs ?? []).find((t) => t.id === a.panelId);
      const dir = normPath(a.directory) ?? wsDir;
      const entry = { wsId: w.id, agent: a, subtitle: a.title || tab?.title || segments(dir).pop() || a.name };
      if (!dir) {
        folderless(w).agents.push(entry);
        continue;
      }
      const path = worktreeOf(dir);
      const own = path === wsDir;
      ensure(path, {
        key: "t:" + path, path, repo: repoOf(path),
        branch: tab?.branch ?? (own ? w.branch : undefined),
        dirty: tab?.dirty ?? (own ? w.dirty : undefined),
        wsId: w.id, owner: own, selected: own && w.selected,
      }).agents.push(entry);
    }
    if (!wsDir && agents.length === 0) folderless(w);
  }

  const repos = new Map();
  for (const t of trees.values()) {
    t.label = t.branch ?? t.title ?? segments(t.path).pop() ?? t.path;
    t.agents.sort((x, y) =>
      (statusMeta(x.agent.status).rank - statusMeta(y.agent.status).rank)
      || ((y.agent.lastActivityAt ?? 0) - (x.agent.lastActivityAt ?? 0)));
    if (!repos.has(t.repo)) repos.set(t.repo, { repo: t.repo, trees: [], working: 0, waiting: 0, total: 0 });
    const r = repos.get(t.repo);
    r.trees.push(t);
    for (const { agent } of t.agents) {
      r.total += 1;
      if (agent.status === "working") r.working += 1;
      if (agent.status === "needs_input") r.waiting += 1;
    }
  }

  const ordered = [...repos.values()].sort((a, b) =>
    (Number(b.waiting > 0) - Number(a.waiting > 0))
    || (Number(b.working > 0) - Number(a.working > 0))
    || a.repo.localeCompare(b.repo));

  const out = [];
  for (const r of ordered) {
    out.push({
      key: "r:" + r.repo, kind: "repo", repo: r.repo,
      working: r.working, waiting: r.waiting, total: r.total,
    });
    r.trees.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    for (const t of r.trees) {
      out.push({
        key: t.key, kind: "worktree", path: t.path, label: t.label, isGit: t.branch !== undefined,
        dirty: t.dirty === true, wsId: t.wsId, selected: t.selected === true,
      });
      for (const { wsId, agent, subtitle } of t.agents) {
        const id = wsId + ":" + agent.id;
        out.push({ key: "a:" + id, kind: "agent", wsId, agent, subtitle });
        const children = [...(agent.children ?? [])].sort((x, y) =>
          (Number(y.running) - Number(x.running)) || ((x.startedEpoch ?? 0) - (y.startedEpoch ?? 0)));
        for (const child of children.slice(0, MAX_CHILDREN)) {
          out.push({ key: "c:" + id + ":" + child.id, kind: "child", wsId, agent, child });
        }
        if (children.length > MAX_CHILDREN) {
          const text = "+" + (children.length - MAX_CHILDREN) + " more subagents";
          out.push({ key: "m:" + id, kind: "more", wsId, agent, text });
        }
      }
    }
  }
  // Repos that need you sort first, so the cap drops the least urgent rows.
  if (out.length > MAX_ROWS) {
    const text = "+" + (out.length - MAX_ROWS) + " more rows";
    return [...out.slice(0, MAX_ROWS), { key: "m:rows", kind: "more", text }];
  }
  return out;
}

// ── view ─────────────────────────────────────────────────────────────────────

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

// In-flight agents tick a live elapsed; settled ones show how long ago.
function agentTime(a, epoch) {
  if (live(a) && a.sinceEpoch) return fmtElapsed(epoch - a.sinceEpoch);
  if (a.lastActivityAt) return fmtAgo(epoch - a.lastActivityAt) + " ago";
  return "";
}

function focusAgent(row) {
  cmux("workspace.select", { workspace_id: row.wsId });
  if (row.agent.surfaceId) cmux("surface.focus", { surface_id: row.agent.surfaceId, workspace_id: row.wsId });
}

// Status bar on the left edge: coloured while the agent needs attention or is
// running, invisible otherwise, so the eye lands on live rows first.
function edgeBar(colorFn) {
  return RoundedRectangle({ width: 3, height: 26, cornerRadius: 1.5 }).fill(colorFn);
}

const rows = computed(() => buildRows(data.workspaces() ?? [], epochNow()));

const counts = computed(() => {
  const c = { working: 0, waiting: 0 };
  for (const r of rows()) {
    if (r.kind !== "repo") continue;
    c.working += r.working;
    c.waiting += r.waiting;
  }
  return c;
});

function headerRow() {
  return HStack({ spacing: 8 }, [
    Text("Agents").font(14).weight("semibold").monospaced().lineLimit(1).fixedSize(),
    Spacer(),
    Text(() => (counts().waiting > 0 ? "❓ " + counts().waiting : ""))
      .font(11).monospaced().color(STATUS.needs_input.color).fixedSize(),
    Text(() => (counts().working > 0 ? "⚡ " + counts().working : ""))
      .font(11).monospaced().color(STATUS.working.color).fixedSize(),
    Text(() => data.clock()?.time ?? "").font(11).monospaced().color("tertiary").lineLimit(1).fixedSize(),
  ]).paddingHorizontal(10);
}

function repoRow(row) {
  return HStack({ spacing: 6 }, [
    Text(() => row().repo.toUpperCase())
      .font(10).weight("semibold").monospaced().color("secondary")
      .lineLimit(1).truncation("tail"),
    Spacer(),
    Text(() => (row().waiting > 0 ? "❓" + row().waiting : ""))
      .font(10).monospaced().color(STATUS.needs_input.color),
    Text(() => (row().working > 0 ? "⚡" + row().working : ""))
      .font(10).monospaced().color(STATUS.working.color),
    Text(() => String(row().total)).font(10).monospaced().color("tertiary"),
  ]).paddingHorizontal(10).paddingTop(10);
}

function worktreeRow(row) {
  return HStack({ spacing: 6 }, [
    edgeBar(() => (row().selected ? "accent" : "clear")),
    // A folder icon when cmux knows no branch, so a plain folder that shares
    // its repo header's name reads as a folder, not a second repo.
    Image(() => (row().isGit ? "arrow.triangle.branch" : "folder")).font(10).color("tertiary"),
    Text(() => row().label)
      .font(12).monospaced().lineLimit(1).truncation("middle")
      .color(() => (row().selected ? "primary" : "secondary")),
    Text(() => (row().dirty ? "✱" : "")).font(11).color("#FFD60A"),
    Spacer(),
  ])
    .paddingHorizontal(6).paddingVertical(2)
    .cornerRadius(6)
    .background(() => (row().selected ? "#7f7f7f24" : null))
    .hoverBackground("#7f7f7f1c")
    .cursor("pointer")
    .frame({ maxWidth: "infinity" })
    .onTap(() => cmux("workspace.select", { workspace_id: row().wsId }));
}

function agentRow(row) {
  const a = () => row().agent;
  return HStack({ spacing: 6 }, [
    edgeBar(() => (live(a()) ? statusMeta(a().status).color : "clear")),
    VStack({ spacing: 1 }, [
      HStack({ spacing: 6 }, [
        Text(() => statusMeta(a().status).glyph).font(11).color(() => statusMeta(a().status).color),
        Text(() => a().kind ?? a().name).font(11).monospaced().color("secondary").lineLimit(1),
        Text(() => statusMeta(a().status).label).font(11).color(() => statusMeta(a().status).color),
        Spacer(),
        Text(() => agentTime(a(), epochNow())).font(10).monospaced().color("tertiary")
          .lineLimit(1).fixedSize().layoutPriority(2),
      ]),
      // Never empty: the first prompt, else the tab title, else the folder, so
      // two sessions of the same agent kind can be told apart.
      Text(() => row().subtitle ?? "")
        .font(10).color("tertiary").lineLimit(1).truncation("tail"),
    ]),
  ])
    .paddingLeading(16).paddingTrailing(6).paddingVertical(2)
    .cornerRadius(6)
    .hoverBackground("#7f7f7f1c")
    .cursor("pointer")
    .frame({ maxWidth: "infinity" })
    .onTap(() => focusAgent(row()));
}

function childRow(row) {
  const c = () => row().child;
  return HStack({ spacing: 6 }, [
    Text("↳").font(10).monospaced().color("tertiary"),
    Text(() => (c().running ? "⚡" : "✓")).font(10)
      .color(() => (c().running ? STATUS.working.color : "tertiary")),
    Text(() => c().label ?? "subagent")
      .font(10).lineLimit(1).truncation("tail")
      .color(() => (c().running ? "secondary" : "tertiary")),
    Spacer(),
    Text(() => {
      const end = c().running ? epochNow() : (c().endedEpoch ?? epochNow());
      return fmtElapsed(end - (c().startedEpoch ?? end));
    }).font(10).monospaced().color("tertiary").lineLimit(1).fixedSize().layoutPriority(2),
  ])
    .paddingLeading(28).paddingTrailing(6).paddingVertical(1)
    .cornerRadius(6)
    .hoverBackground("#7f7f7f1c")
    .frame({ maxWidth: "infinity" })
    .onTap(() => focusAgent(row()));
}

// "+N more" after a capped list. Under an agent it opens that agent; at the
// end of the whole list there is nothing to open.
function moreRow(row) {
  return Text(() => row().text)
    .font(10).color("tertiary").lineLimit(1)
    .paddingLeading(() => (row().agent ? 28 : 10)).paddingVertical(1)
    .frame({ maxWidth: "infinity" })
    .onTap(() => {
      if (row().agent) focusAgent(row());
    });
}

const ROW_VIEWS = { repo: repoRow, worktree: worktreeRow, agent: agentRow, child: childRow, more: moreRow };

sidebar(() =>
  VStack({ spacing: 4 }, [
    headerRow(),
    Divider(),
    ForEach({ items: rows, key: (r) => r.key }, (r) => ROW_VIEWS[r().kind](r)),
    Text(() => (rows().length === 0
      ? "No workspaces yet. Agents started in cmux terminals show up here with live status."
      : ""))
      .font(11).color("tertiary").paddingHorizontal(10),
    Spacer(),
  ]).paddingHorizontal(6).paddingVertical(8),
  { surface: "glass" },
);
