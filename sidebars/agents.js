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

const STATUS = {
  needs_input: { glyph: "❓", label: "waiting on you", color: "#FF9F0A", rank: 0 },
  working: { glyph: "⚡", label: "working", color: "#30D158", rank: 1 },
  idle: { glyph: "✓", label: "done", color: "#8E8E93", rank: 2 },
  ended: { glyph: "·", label: "ended", color: "#7f7f7f66", rank: 3 },
};

function statusMeta(status) {
  return STATUS[status] ?? { glyph: "·", label: String(status), color: "#7f7f7f66", rank: 9 };
}

function segments(path) {
  return String(path ?? "").split("/").filter((p) => p.length > 0);
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
    .map((w) => w.directory)
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
    t.selected = t.selected || init.selected;
    return t;
  };

  for (const w of workspaces) {
    const agents = (w.agents ?? []).filter((a) => visible(a, epoch));
    if (w.directory) {
      ensure(w.directory, {
        key: "t:" + w.directory, path: w.directory, repo: repoOf(w.directory),
        branch: w.branch, dirty: w.dirty, wsId: w.id, selected: w.selected,
      });
    }
    for (const a of agents) {
      const dir = a.directory ?? w.directory;
      if (!dir) {
        ensure("ws:" + w.id, {
          key: "t:ws:" + w.id, repo: "Other", title: w.title, wsId: w.id, selected: w.selected,
        }).agents.push({ wsId: w.id, agent: a });
        continue;
      }
      const path = worktreeOf(dir);
      const tab = (w.tabs ?? []).find((t) => t.id === a.panelId);
      const own = path === w.directory;
      ensure(path, {
        key: "t:" + path, path, repo: repoOf(path),
        branch: tab?.branch ?? (own ? w.branch : undefined),
        dirty: tab?.dirty ?? (own ? w.dirty : undefined),
        wsId: w.id, selected: w.selected,
      }).agents.push({ wsId: w.id, agent: a });
    }
    if (!w.directory && agents.length === 0) {
      ensure("ws:" + w.id, {
        key: "t:ws:" + w.id, repo: "Other", title: w.title, wsId: w.id, selected: w.selected,
      });
    }
  }

  const repos = new Map();
  for (const t of trees.values()) {
    t.label = t.branch ?? t.title ?? segments(t.path).pop();
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
    r.trees.sort((a, b) => a.label.localeCompare(b.label));
    for (const t of r.trees) {
      out.push({
        key: t.key, kind: "worktree", path: t.path, label: t.label,
        dirty: t.dirty === true, wsId: t.wsId, selected: t.selected === true,
      });
      for (const { wsId, agent } of t.agents) {
        out.push({ key: "a:" + wsId + ":" + agent.id, kind: "agent", wsId, agent });
        const children = [...(agent.children ?? [])].sort((x, y) =>
          (Number(y.running) - Number(x.running)) || ((x.startedEpoch ?? 0) - (y.startedEpoch ?? 0)));
        for (const child of children) {
          out.push({ key: "c:" + wsId + ":" + agent.id + ":" + child.id, kind: "child", wsId, agent, child });
        }
      }
    }
  }
  return out;
}

sidebar(() => VStack([]));
