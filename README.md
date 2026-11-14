# cmux-agent-sidebar

A [cmux](https://github.com/manaflow-ai/cmux) custom sidebar that shows where each coding agent is running, and whether it is running, waiting on you, or done. Use it as your left pane in place of the workspace list.

<!-- TODO: screenshot at assets/sidebar.png -->

```
Agents                        ● 1  ● 1
⑂ bluebird / feat/waitlist-export ✱
   ● ◆ Export waitlist as CSV       1m 12s
   ✓ ✻ Fix ingest retry               12m
⑂ dotfiles · master
   ● ✻ Organizing home folder  ↳2   4m 05s
▢ Repos
```

- One line per agent: status mark, agent (`✻` Claude, `◆` Codex), title, time.
- Status: blue ● running, orange ● waiting on you, green ✓ done, gray ○ ended.
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
- When it finishes, it changes to a green **✓**.
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
2. **Start `claude` or `codex` inside that folder.** An agent is grouped by the folder it was started in.
3. **More agents for the same project go in tabs or splits** of that workspace.

## How it groups

Each agent goes in the group for its folder, or for the workspace folder that contains it. Group names:

| Folder | Shown as |
|---|---|
| `…/worktrees/<repo>/<branch>` | ⑂ `repo / branch` |
| A git checkout | ⑂ `folder · branch` |
| Any other folder | folder icon and name |
| Workspace with no folder | folder icon and workspace name |

- Groups keep cmux's workspace order.
- `✱` means uncommitted changes.

## Rename an agent

An agent's title is its terminal tab's title. Claude Code names the tab after the conversation. To rename it, rename the tab in cmux:

- **From inside Claude Code**, type this as a prompt. The `!` runs it as a shell command in that tab:
  ```
  ! cmux rename-tab "Fix ingest retry"
  ```
- **From another terminal**, name the tab: `cmux rename-tab --surface <surface> "Fix ingest retry"`. `cmux tree` lists the surfaces.

If a tab is still titled with a path or the agent's name, the sidebar shows the agent's first prompt instead.

## Width and hiding

cmux controls these, not the sidebar:

- **Width:** drag the sidebar's edge. Rows truncate instead of wrapping.
- **Hide:** bind the `toggleSidebar` shortcut in cmux settings. cmux has no auto-hide.

Status colors and ordering are in [docs/design.md](docs/design.md#status).

## Known limits

- **Grouped by where the agent started.** An agent started in `~/Repos` stays under `Repos`, even if it edits a worktree. Knowing which files an agent edits would need hooks.
- **Background subagents drop out of `↳N` early.** cmux marks a subagent finished when the call that started it returns. A subagent launched in the background keeps running after that.
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
