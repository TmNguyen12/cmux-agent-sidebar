# cmux-agent-sidebar

A [cmux](https://github.com/manaflow-ai/cmux) custom sidebar that shows where each coding agent is running, and whether it is running, waiting on you, or done. Use it as your left pane in place of the workspace list.

<!-- TODO: screenshot at assets/sidebar.png -->

```
Agents                        ● 1  ● 1
BLUEBIRD
  ⌘1 ⑂ main ✱
     ⌃1 ● ✻ Fix ingest retry           12m
  ⌘2 ⑂ waitlist-export
        ● ◆ Export waitlist as CSV   1m 12s
DOTFILES
  ⌘3 ⑂ master
        ● ✻ Organizing home  ↳2     4m 05s
⌘4 ▢ Repos
```

- One line per agent: status mark, agent (`✻` Claude, `◆` Codex), title, time.
- Status dots: blue running, orange waiting on you, green done, gray ○ ended.
- Click a group to switch to its workspace. Click an agent to jump to its terminal.
- No hooks, background jobs or network access. See [SECURITY.md](SECURITY.md).

## Install

### What you need

- cmux with Custom Sidebars on (the default). Check under **Settings → Custom Sidebars**.
- Agents started from a cmux terminal. cmux tracks their state through its own `claude`/`codex` wrapper.

### 1. Copy the sidebar into cmux

**In a terminal, from this repo:**

```sh
./install.sh
```

Expect:

```
installed /Users/<you>/.config/cmux/sidebars/agents.js
OK agents [js] /Users/<you>/.config/cmux/sidebars/agents.js
1 valid, 0 invalid.
```

| Result | What to do |
|---|---|
| `backed up your existing …` | You had a different `agents.js`. Your copy is saved next to it as `agents.js.bak.<time>`. |
| `cmux is not on PATH` | Install cmux, open it once, then rerun. |
| `invalid` | Stop and keep the output. |

### 2. Show it

```sh
cmux sidebar select agents
```

Or open it as a pane next to your terminals: `cmux sidebar open agents`.

### 3. Check that it works

Start `claude` or `codex` in any cmux workspace and send a prompt.

- The agent shows a blue **●** under its folder's group.
- When it finishes, the dot turns green.
- A group with no agents only proves the workspace list works, not agent tracking.

## Update

Pull and rerun `./install.sh`. cmux hot-reloads the file. An unchanged file makes no backup.

## Organize your workspaces

If you come from iTerm2: a cmux **workspace** is like an iTerm2 tab that holds its own splits and tabs.

| iTerm2 | cmux |
|---|---|
| Window | Window |
| Tab | Workspace (a row in the left sidebar) |
| Split pane | Pane |
| *(none)* | Tab, inside a pane |

This sidebar groups best with one habit:

1. **One workspace per worktree or project**, opened in its folder:
   ```sh
   cmux new-workspace --cwd ~/Repos/worktrees/<repo>/<branch>
   ```
2. **Start `claude` or `codex` inside that folder.** An agent is grouped by its tab's folder, which is where it started unless it [moves into a worktree](#follow-an-agent-into-a-worktree).
3. **More agents for the same project go in tabs or splits** of that workspace.

## Follow an agent into a worktree

Optional. Do this if you start an agent in a repo and it creates a worktree as you talk to it.

cmux learns a tab's folder from the shell prompt (the OSC 7 escape code). A running agent prints no prompt, so cmux keeps the folder the agent started in. These two steps make a Claude Code agent report its new folder.

### What you need

- Claude Code with a `statusLine` command in `~/.claude/settings.json`. If you have none, see [Claude Code's status line docs](https://code.claude.com/docs/en/statusline).
- `jq` on your PATH.

### 1. Have Claude switch into the worktree

Claude Code's `EnterWorktree` tool moves the session into a worktree. Claude only uses it when you or a CLAUDE.md mentions worktrees.

**Add to `~/.claude/CLAUDE.md`:**

```md
- After creating a git worktree for a task, switch the session into it with the EnterWorktree tool (pass the worktree as `path`). Don't work in it with `git -C` or absolute paths from the original folder.
```

- `EnterWorktree` with `path` enters a worktree you made with `git worktree add`, wherever it lives.
- `EnterWorktree` with `name` creates a new worktree under `.claude/worktrees/` in the repo.
- Running `cd` or `git -C` doesn't count. The session's folder stays where it was.

### 2. Report the folder from your status line

Claude Code reruns the status line often and passes it the session's current folder. This block sends that folder to the tab.

**Add to your status line script, after it reads its input into `$input`:**

```sh
# report the session folder to the terminal (OSC 7), so cmux follows a
# session into a worktree; the shell only reports it at a prompt. This script
# has no controlling tty, so write to the nearest ancestor's terminal.
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
if [ -n "$cwd" ]; then
  pid=$PPID
  for _ in 1 2 3 4; do
    t=$(ps -o tty= -p "$pid" 2>/dev/null | tr -d ' ')
    case "$t" in
      ""|"??") pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' '); [ -n "$pid" ] || break ;;
      *) { printf '\033]7;file://%s%s\033\\' "$(hostname)" "$cwd" > "/dev/$t"; } 2>/dev/null; break ;;
    esac
  done
fi
```

- The status line runs with no terminal of its own, so `/dev/tty` doesn't work. The loop finds the Claude process's terminal instead.
- This lives in your Claude Code config, not in this sidebar. It writes one escape code to the agent's own tab and nothing else.

### 3. Check that it works

In an agent's tab, ask Claude to enter an existing worktree.

Expect, within a few seconds:

- Claude's status line shows the worktree folder.
- The agent moves to the worktree's row under its repo in the sidebar.

| Result | What to do |
|---|---|
| Status line still shows the old folder | Claude didn't use `EnterWorktree`. Ask it to, and check step 1. |
| Status line shows the worktree, sidebar doesn't | The block isn't running. Check that `statusLine` points at the script you edited. Then run `cmux current --json \| grep '"cwd"'` and look for the worktree. |
| A Codex agent stays in the old group | Expected. Start Codex inside the worktree instead. |

## How it groups

Each agent goes in the group for its folder, or for the workspace folder that contains it. Groups from one repo sit under a repo header.

| Folder | Shown as |
|---|---|
| `<parent>/<repo>`, a git checkout | `branch`, under the `REPO` header |
| `<parent>/worktrees/<repo>/<folder>` | `folder`, under the same `REPO` header |
| Any other folder | folder icon and name, no header |
| Workspace with no folder | folder icon and workspace name, no header |

- The sidebar can't run git, so it finds the repo from that folder layout. A worktree kept somewhere else gets its own header.
- A repo shows its header even with one checkout, so the layout doesn't jump when you add a worktree.
- The repo header is only a label. Click a checkout row to switch to its workspace.
- Rows don't move when you switch tabs or an agent changes status:
  - Repos and groups follow cmux's workspace order. Within a repo, the main checkout comes first, then the others by folder name.
  - Agents follow tab order.
- `✱` means uncommitted changes. Worktree groups never show it.
- A worktree is named by its folder, not its branch. Name worktree folders after their branch to see both. cmux only updates a tab's branch and `✱` at a shell prompt, so they'd be wrong after an agent [moves into a worktree](#follow-an-agent-into-a-worktree).
- `⌃2` on an agent is its tab key: press the group's `⌘N`, then `⌃2`. It only shows when the workspace has more than one tab.
- `⌘2` on a group is the key that selects its workspace. Two groups can share a key when one workspace has agents in two folders. To give one its own key, move that tab out: `cmux move-tab-to-new-workspace --surface <surface>`.

## Rename an agent

An agent's title is its terminal tab's title. Claude Code names the tab after the conversation. To rename it, rename the tab in cmux:

- **Press ⌘R** in the agent's tab and type the new name.
- **Or from a script:** `cmux rename-tab --surface <surface> "Fix ingest retry"`. `cmux tree` lists the surfaces.

If a tab is still titled with a path or the agent's name, the sidebar shows the agent's first prompt instead.

## Width and hiding

cmux controls these, not the sidebar:

- **Width:** drag the sidebar's edge. Rows truncate instead of wrapping.
- **Hide:** bind the `toggleSidebar` shortcut in cmux settings. cmux has no auto-hide.

Status colors and ordering are in [docs/design.md](docs/design.md#status).

## Known limits

- **Grouped by the tab's folder.** An agent started in `~/Repos` stays under `Repos`, even if it edits a worktree, until its session switches folders. Claude Code can [report the switch](#follow-an-agent-into-a-worktree). Codex can't, so start Codex in the worktree. Grouping by the files an agent edits would need hooks.
- **Background subagents drop out of `↳N` early.** cmux marks a subagent finished when the call that started it returns. A subagent launched in the background keeps running after that.
- **Tab keys assume no split panes.** cmux numbers tabs per pane, but the sidebar only sees a workspace's tabs as one list. In a workspace with splits, `⌃N` can point at the wrong tab.
- **Two workspaces on one folder share a group.** Clicking the group opens the selected one, else the first. Their agents stay clickable.

## Development

```sh
npm test
```

- No dependencies. Tests use Node's built-in runner (Node 22+).
- `tests/harness.mjs` loads `sidebars/agents.js` with cmux's sidebar API stubbed.
- The stubs can't prove the real render. After a change, run `./install.sh` and look at the sidebar.

## License

[MIT](LICENSE)
