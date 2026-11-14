# cmux-agent-sidebar

A [cmux](https://github.com/manaflow-ai/cmux) custom sidebar that shows which repo and worktree each coding agent is running in, and whether it is working, waiting on you, or done.

<!-- TODO: screenshot at assets/sidebar.png -->

```
Agents                    ❓ 1  ⚡ 2  14:02:11
BLUEBIRD-PLATFORM                    ❓1 ⚡1 3
  ⑂ feat/waitlist-export ✱
      ❓ codex   waiting on you         1m 12s
      ✓ claude  done                  12m ago
  ⑂ main
      ⚡ claude  working                4m 05s
```

- Works with Claude Code and Codex, plus any agent cmux tracks.
- Click a worktree to switch to its workspace. Click an agent to jump to its terminal.
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

- The agent shows as **⚡ working** under its repo and worktree.
- When it finishes, it changes to **✓ done**.
- A worktree row with no agents only proves the workspace list works, not agent tracking.

## Update

Pull and rerun `./install.sh`. cmux hot-reloads the file. An unchanged file makes no backup.

## How it groups

- **Repo:** the folder after `worktrees/` in `…/worktrees/<repo>/<branch>`, otherwise the folder name.
- **Worktree:** the agent's folder, or the workspace's folder that contains it.
- **Branch:** from the agent's terminal tab, otherwise the workspace.
- Workspaces with no folder are listed under **Other**.

Status colors and ordering are in [docs/design.md](docs/design.md#status).

## Development

```sh
npm test
```

- No dependencies. Tests use Node's built-in runner (Node 22+).
- `tests/harness.mjs` loads `sidebars/agents.js` with cmux's sidebar API stubbed.
- The stubs can't prove the real render. After a change, run `./install.sh` and look at the sidebar.

## License

[MIT](LICENSE)
