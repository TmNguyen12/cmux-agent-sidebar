# cmux-agent-sidebar design

createdAt: 2026-11-13 23:05 EST
lastUpdated: 2026-11-14 02:40 EST

## Intent

A cmux custom sidebar, used as the left pane in place of the workspace list,
that shows where each coding agent (Claude Code, Codex) is running and whether
it is running, waiting on you, or done. It must add no hooks and no background
scripts, so it adds no new code to every agent turn.

## Goals

- Read only cmux's built-in sidebar data (`data.workspaces()`, `data.clock()`).
  The sidebar runtime has no filesystem, network, timers or child processes.
- One level of groups: a worktree, else a git repo, else a plain folder.
- One line per agent, telling two sessions of the same agent apart by title.
- Narrow-friendly: rows truncate instead of forcing a minimum width.
- Click a group to select its workspace; click an agent to focus its terminal.
- Show groups that have no agents, so this sidebar can replace the workspace list.

## Non-goals

- Usage quotas (handled separately by ClaudeUsageBar).
- Drag-to-reorder, search.
- Sidebar width and auto-hide. cmux owns them: drag the edge to resize, bind
  `toggleSidebar` to hide.

## Anti-goals

- Anything that needs `~/.claude/settings.json` hooks, launchd jobs or a
  helper script outside the sidebar file.
- In-sidebar text fields or extra cmux commands for renaming. Renames use
  cmux's own tab rename.

## Approaches considered

1. **Reactive JS sidebar (`.js`)**: chosen. Runs once, then binds to signals;
   keyed rows keep identity across the ~1s data refresh.
2. Interpreted Swift (`.swift`), as cmux-sentinel uses. Rebuilds the whole
   view every tick; no keyed identity.
3. Fork cmux's `panel-subagents` template. Organised by workspace, not
   repo/worktree, so most of it would be rewritten anyway.

Placement: the left pane (chosen) or a right-sidebar panel, which has a
`rightMaxWidth` cap. The user chose the left pane.

## How it works

### Groups

- An agent's folder is `agent.directory`, else its workspace's `directory`.
  A folder inside a workspace's folder belongs to that workspace's group.
- Branch and dirty state come from the agent's hosting tab
  (`agent.panelId` → `workspace.tabs[k].id`), else the workspace.
- Label, by the first rule that applies:

  | Folder | Label | Icon |
  | --- | --- | --- |
  | `…/worktrees/<repo>/<rest>` | `<repo> / <branch or rest>` | branch |
  | Branch known | `<folder> · <branch>` | branch |
  | Otherwise | `<folder>` | folder |
  | Workspace with no folder | workspace title | folder |

- Groups keep cmux's workspace order, so positions stay stable.
- Each group shows its workspace's ⌘1…⌘9 key. A group that is only an agent's
  folder (the agent was started outside its workspace's folder) shows
  `in ⌘N`, the key of the workspace hosting it.

### Agent rows

One line: status mark, kind symbol, title, subagent count, time.

- **Kind symbol:** `✻` Claude in its clay color, `◆` Codex in the text color, else the kind's first letter.
- **Title:** the tab title (Claude Code's topic, or your rename); else the first
  prompt when the tab title is a path or the agent's name; else the folder.
- **Subagents:** `↳N` when N subagents are running.
- **Time:** live elapsed while running or waiting (`4m 05s`); `12m ago` when done.
- **Group key:** the workspace's `⌘N` sits left of the group name, away from the times.

### Status

| cmux `agent.status` | Mark | Color | Order in group |
| --- | --- | --- | --- |
| `needs_input` | ● | Mocha Peach | 0 |
| `working` | ● | Mocha Blue | 1 |
| `idle` | ● | Mocha Green | 2 |
| `ended` | ○ | Mocha Overlay0; hidden 15 min after last activity | 3 |

Every status is a dot, told apart by color. This is a personal tool and the user chose color only.

### Look

Header `Agents` with live running and waiting counts. Each group and its agents
form a card; the selected workspace's card is raised with a lighter fill, a
hairline outline and rounded corners (the runtime has no shadow). Highlight
colors are faint Catppuccin Mocha Lavender washes (5% card fill, 25% outline,
8% focus, 6% hover), kept in one `MOCHA` table in the sidebar file. Inside it, the
agent whose terminal has focus gets a faint fill. Group rows show the key, label
and a `✱` when dirty. At most 200 rows, then "+N more".

## Left to the builder

Exact colors, spacing and empty-state copy.
