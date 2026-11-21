# cmux-agent-sidebar design

createdAt: 2026-11-13 23:05 EST
lastUpdated: 2026-11-21 10:28 EST

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
- Reach every workspace by click, including a second shell opened on a folder
  that already has a group.

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
  folder with a known branch is its own repo, unless it folds into a checkout
  or is named `_…` or `.…` (below). A folder with no known branch joins a repo
  only as that repo's main checkout.
- A checkout's subfolder reports the checkout's branch, so a workspace sitting
  in one joins the outermost open checkout that holds it on the same branch
  (`wsRoot`). It counts as a second workspace on the checkout's folder: it
  takes the row and its ⌘ key only while selected. The workspace itself never
  sets the row's branch or dirty state, but its agents' tabs can, as any
  agent's tab can for its group. The cost: a separate repo nested inside an
  open checkout on the same branch name folds in too, so a repo at `~` on
  `main` absorbs every repo under it on `main`.
- A worktree inside a checkout (`.claude/worktrees/<wt>`) never folds, since
  its reported branch can be the checkout's, stale from before an agent moved
  in.
- A `_` or `.` folder (`hiddenName`) is never a repo, so with no checkout to
  join it is a plain folder. The cost: a real repo named that way, such as
  `~/.dotfiles`, also shows as a plain folder.
- A worktree is `…/worktrees/<repo>/<wt>`, the first folder only
  (`worktreeRoot`). Claude Code keeps an agent's `cd`, so its folder can be a
  subfolder; trimming keeps it in its worktree's group. A worktree named with
  a slash shows as its first folder.
- Label, by the first rule that applies:

  | Folder | Label | Icon |
  | --- | --- | --- |
  | `…/worktrees/<repo>/<wt>/…` | `<wt>` under the `<repo>` header, no `✱` | branch |
  | Branch known, not named `_…` or `.…` | `<branch>` under the `<folder>` header | branch |
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

### Shell rows

A group row selects one workspace, the selected one on its folder or else the
first. A second workspace on that folder with no agents, such as a new plain
shell, would have no row of its own. So when a folder has more than one
workspace, each of them with no visible agents gets a shell row under the
folder's group, after the agent rows, in workspace order.

One line: the workspace's `⌘N`, a terminal icon, the workspace title (else
`shell`). No time. It shares the agent row's insets, so the key and title
columns line up. Clicking it selects that workspace.

- A folder's only workspace gets none; its group row stands for it.
- A workspace folded into a checkout (`wsRoot`) counts toward that checkout's
  folder. An agent whose own folder lands it in a group does not.
- A workspace whose agents have all ended and hidden counts as having none.
- A workspace with no folder already has its own group, so it gets none.
- Shell rows don't count toward the group's running, waiting or total counts.
- A workspace whose agents all sit in other folders gets none on its own
  folder. Its agent rows already reach it.

### Status

| cmux `agent.status` | Mark | Color |
| --- | --- | --- |
| `needs_input` | ● | Mocha Peach |
| `working` | ● | Mocha Blue |
| `idle` | ● | Mocha Green |
| `ended` | ○ | Mocha Overlay0; hidden 15 min after last activity |

Every status is a dot, told apart by color. This is a personal tool and the user chose color only.

### Questions

An agent that ends its turn on a question is `idle` to cmux. The sidebar shows
it as `needs_input` instead, and counts it as waiting. Its time still reads
`12m ago`: how long since it asked.

- The text comes from `workspace.latestMessage`, read but never shown.
- cmux gives one last message per workspace. It is read as the message of the
  workspace's most recently active agent (`askingAgentId`), and only while
  that agent is `idle`.
- The cost: with two agents in one workspace, the older one's question is lost
  once the other speaks.
- The dot returns to green when the agent's next message asks nothing.

`asksQuestion` reads back from the end of the message:

| Line | Effect |
| --- | --- |
| Ends in `?`, allowing closing markdown, quotes or brackets | A question |
| `[confidence: N/10 …]` with N under 7 | A question; the author's agents must stop and ask below 7 |
| `[confidence: N/10 …]` with N of 7 or more | Skipped |
| A bullet or numbered item | Checked for `?`, then skipped |
| Any other line | Checked for `?`; the third such line ends the search |

- Options usually sit under their question, so list lines don't use up the
  three prose lines.
- The search covers at most the last 40 lines and 4,000 characters, to stay
  inside the render budget.
- A closing offer such as "Want me to also do X?" counts. It is a decision
  waiting on you.
- An ask with no question mark, such as "say so and I'll do it", is missed.

### Look

Header `Agents` with live running and waiting counts. Each group with its agent
and shell rows forms a card; the selected workspace's card is raised with a
lighter fill, a hairline outline and rounded corners (the runtime has no
shadow). Highlight
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
