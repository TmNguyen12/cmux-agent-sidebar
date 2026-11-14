# cmux-agent-sidebar design

createdAt: 2026-11-13 23:05 EST
lastUpdated: 2026-11-13 23:05 EST

## Intent

A cmux custom sidebar that shows, at a glance, which repo and worktree each
coding agent (Claude Code, Codex) is running in, and whether it is working,
waiting on you, or done. It must add no hooks and no background scripts, so it
adds no new code to every agent turn.

## Goals

- Read only cmux's built-in sidebar data (`data.workspaces()`, `data.clock()`).
  The sidebar runtime has no filesystem, network, timers or child processes.
- Group agents as repo → worktree → agent, with subagents indented under their parent.
- Click a worktree to select its workspace; click an agent to focus its terminal.
- Show worktrees that have no agents, so this sidebar can replace the workspace list.

## Non-goals

- Usage quotas (handled separately by ClaudeUsageBar).
- Drag-to-reorder, search.

## Anti-goals

- Anything that needs `~/.claude/settings.json` hooks, launchd jobs or a
  helper script outside the sidebar file.

## Approaches considered

1. **Reactive JS sidebar (`.js`)** — chosen. Runs once, then binds to signals;
   keyed rows keep identity across the ~1s data refresh.
2. Interpreted Swift (`.swift`), as cmux-sentinel uses. Rebuilds the whole
   view every tick; no keyed identity.
3. Fork cmux's `panel-subagents` template. Organised by workspace, not
   repo/worktree, so most of it would be rewritten anyway.

## How it works

### Grouping

- An agent's worktree path is `agent.directory`, else its workspace's `directory`.
- Branch and dirty state come from the agent's hosting tab
  (`agent.panelId` → `workspace.tabs[k].id`), else the workspace.
- Repo name: the `<repo>` segment of `…/worktrees/<repo>/<branch>`; otherwise
  the last path segment of the worktree path.
- A workspace with no directory and no agents goes under **Other**.

### Status

| cmux `agent.status` | Shown as | Order |
| --- | --- | --- |
| `needs_input` | ❓ waiting on you, amber, live elapsed | 0 |
| `working` | ⚡ working, green, live elapsed | 1 |
| `idle` | ✓ done, dim, "12m ago" | 2 |
| `ended` | ended, dim; hidden 15 min after last activity | 3 |

Repos with a waiting agent sort first, then repos with a working agent, then
the rest alphabetically.

### Look

Styled after cmux-sentinel: header `Agents  ⚡N ❓N  HH:mm:ss`, uppercase
monospace repo headers with agent counts, a coloured left bar on working or
waiting rows.

## Left to the builder

Exact colours, spacing and empty-state copy.
