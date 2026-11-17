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
- Groups per checkout or folder, under a repo header or one Folders header.
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
- cmux updates a tab's branch and dirty state only at a shell prompt. An agent
  that moves into a worktree keeps the old ones, so worktree groups ignore both.
- Repo, by folder layout (`repoOf`), since the runtime can't run git:
  `<parent>/worktrees/<repo>/<wt>` and `<parent>/<repo>` are one repo. A
  folder with a known branch is its own repo. A folder with no known branch
  joins a repo only as that repo's main checkout.
- A checkout's subfolder reports the checkout's branch, so a workspace sitting
  in one joins the outermost open checkout that holds it. A `_` or `.` folder
  is never a repo (`hiddenName`), so with no such checkout open it is a plain
  folder. A real repo nested inside another open checkout folds into it too.
- A worktree is `…/worktrees/<repo>/<wt>`, the first folder only
  (`worktreeRoot`). Claude Code keeps an agent's `cd`, so its folder can be a
  subfolder; trimming keeps it in its worktree's group. A worktree named with
  a slash shows as its first folder.
- Label, by the first rule that applies:

  | Folder | Label | Icon |
  | --- | --- | --- |
  | `…/worktrees/<repo>/<wt>/…` | `<wt>` under the `<repo>` header, no `✱` | branch |
  | Branch known | `<branch>` under the `<folder>` header | branch |
  | Main checkout of a repo, branch unknown | `<folder>` under its header | folder |
  | Otherwise | `<folder>` under the `Folders` header | folder |
  | Workspace with no folder | workspace title under the `Folders` header | folder |

- A repo shows its header even with one checkout, so adding a worktree doesn't
  reshape the list. Headers have no tap; each row under one selects its
  workspace. A thin divider sits between headers.
- Repos keep cmux's workspace order; a repo sits at its first checkout. The
  `Folders` header comes last. Within a repo the main checkout comes first,
  then folder order.
  Within a workspace, groups sort by folder: cmux moves a workspace's folder
  to its focused tab, so ordering by which group owns the workspace folder
  would swap groups on every tab switch.
- Each group shows its workspace's ⌘1…⌘9 key, including a group that is only
  an agent's folder.
- Agents in a group keep workspace order, then tab order, then id. Status
  changes don't move rows; the dot and the header counts show status.

### Agent rows

One line: tab key, status mark, kind symbol, title, subagent count, time.

- **Kind symbol:** `✻` Claude in its clay color, `◆` Codex in the text color, else the kind's first letter.
- **Title:** the tab title (Claude Code's topic, or your rename); else the first
  prompt when the tab title is a path or the agent's name; else the folder.
- **Subagents:** `↳N` when N subagents are running.
- **Time:** live elapsed while running or waiting (`4m 05s`); `12m ago` when done.
- **Group key:** the workspace's `⌘N` sits left of the group name, away from the times.
- **Tab key:** `⌃N`, the agent's tab position in its workspace, when the workspace
  has more than one tab. The sidebar data has no split panes, so with splits the
  number can point at the wrong tab.

### Status

| cmux `agent.status` | Mark | Color |
| --- | --- | --- |
| `needs_input` | ● | Mocha Peach |
| `working` | ● | Mocha Blue |
| `idle` | ● | Mocha Green |
| `ended` | ○ | Mocha Overlay0; hidden 15 min after last activity |

Every status is a dot, told apart by color. This is a personal tool and the user chose color only.

### Look

Header `Agents` with live running and waiting counts. Each group and its agents
form a card; the selected workspace's card is raised with a lighter fill, a
hairline outline and rounded corners (the runtime has no shadow). Highlight
colors sink into Catppuccin Mocha Crust (70% card fill, full for focus, 40%
hover) with a 25% Lavender outline, kept in one `MOCHA` table in the sidebar
file.

The author's terminal background is Crust too (`background = #11111b` in the
Ghostty config), and cmux's `matchTerminalBackground` paints the sidebar to
match. On that background the card fill disappears and the Lavender outline
alone marks the selected card. That is intended: on a Base background the
fill shows again. Inside it, the
agent whose terminal has focus gets a faint fill. Group rows show the key, label
and a `✱` when dirty. At most 200 rows, then "+N more".

## Left to the builder

Exact colors, spacing and empty-state copy.
