# Security

createdAt: 2026-11-13 23:55 EST
lastUpdated: 2026-11-14 01:45 EST

This project exists partly for security reasons. It shows agent state in cmux without adding anything that runs on every agent turn. This page records what was considered and why the design is what it is.

## Summary

| Question | Answer |
|---|---|
| Runs on every prompt or tool call? | No. No Claude Code or Codex hooks. |
| Background jobs? | No. No launchd agents, cron or daemons. |
| Network access? | No. The sidebar runtime has none, and the installer makes no requests. |
| Reads credentials or tokens? | No. |
| Writes files? | The installer writes only inside `~/.config/cmux/sidebars/`. The sidebar writes nothing. |
| macOS permissions needed? | None. Not Screen Recording, Accessibility or Full Disk Access. |
| Dependencies? | None, at runtime or for tests. |

## Why not cmux-sentinel

We reviewed [cmux-sentinel](https://github.com/oliver-kriska/cmux-sentinel) (commit `1082b45`) before writing this. It is well written and we found nothing malicious. The concerns were about its shape:

- **Hook on every event.** Its bridge script runs on every prompt and tool call in every Claude session.
- **Unpinned updates.** Install and update run `curl … | bash` from the `main` branch of a single-maintainer repo. A compromised account would reach every hook on the next update.
- **Token-reading poller.** A launchd job reads the Claude OAuth token every 5 minutes for usage meters.
- **Socket automation mode.** Auto-refresh needs cmux's `socketControlMode: "automation"`, which lets any local process drive cmux.

This sidebar keeps the agent view and drops all four. Usage quotas are left to a separate tool.

## Where agent state comes from

- cmux tracks agent sessions itself. The `claude` and `codex` commands in a cmux terminal resolve to cmux's shims (`~/.cmuxterm/cmux-cli-shims/`), which run cmux's bundled wrapper.
- cmux exposes the result to sidebars as `workspaces[].agents[]`.
- So this sidebar adds no new trust. If you use cmux, you already run that wrapper.

## What the sidebar can do

The sidebar is one file, `sidebars/agents.js`, run by cmux's JavaScript sidebar runtime.

- **Contained by cmux's JS runtime.** No filesystem, network, timers or child processes, and a watchdog stops runaway code. This is a JavaScript context inside the cmux app (in-process by default), not an OS sandbox.
- **Receives** the full workspace object cmux passes to every sidebar, including prompts, last messages, transcript paths and PR links.
- **Displays** workspace titles, folders, branches, dirty state, and each agent's kind, status, times, tab title or first prompt, and running subagent count.
- **Actions:** only `workspace.select` and `surface.focus`, and only from a click on a row. `tests/view.test.mjs` checks that:
  - loading and rendering make no cmux calls;
  - every click handler calls only those two commands;
  - the source names no other cmux command and no `openURL`, `clipboard`, `TextField`, `fetch` or `log`.
- **Clicks are bound to IDs.** A row's click uses the workspace or terminal ID, never a title, branch or prompt, so odd text can't redirect a click.
- **No text fields and no clipboard.** It can't capture keystrokes or swap your clipboard.
- **Capped lists.** At most 200 rows. cmux drops a render that goes over its budget and keeps the last one, which would freeze stale statuses on screen.

## What the installer does

`install.sh` is about 30 lines. Read it before running it.

- Writes `~/.config/cmux/sidebars/agents.js`, creating the folder if needed.
- Backs up a different existing `agents.js` first, as `agents.js.bak.<time>`.
- Refuses to replace `agents.js` when it is a symlink, so a dotfiles manager's link isn't silently broken.
- Runs exactly one cmux command: `cmux sidebar validate agents`.
- No `sudo`, no network, no changes to `~/.claude` or `~/.codex`.
- `tests/install.test.mjs` runs it in a throwaway folder (home, working folder and temp) and fails on any other file, symlink or cmux command.

## Decisions

- **Reactive JS over interpreted Swift.** Same sandbox either way. JS was chosen for performance, not security.
- **Default in-process renderer.** cmux offers an out-of-process renderer (`"customSidebars": { "renderer": "remote" }`) for sidebars you don't trust. This one is small and yours, so in-process keeps hover and keyboard behavior. Switch to remote if you install a modified copy you haven't read.
- **No quotas.** Quotas need a token and a network call outside the sandbox. That is the one piece we chose not to own here.
- **No auto-update.** You update by pulling and rerunning the installer. Nothing fetches code on its own.

## Known exposure

- **Markdown in titles is unverified.** Branch names, folder names, tab titles and prompts go through cmux's `Text`. The cmux docs don't say whether `Text` renders Markdown. If it does, a prompt like `[x](https://example.com)` could show as a link you might click. Check it with the steps in [Verify by hand](#verify-by-hand).
- **Prompts on screen.** An agent's title is its first prompt. It shows in the sidebar, so it is visible when you share your screen.
- **cmux itself.** The wrapper and sidebar runtime are cmux's code, out of scope here. A bug in the runtime's sandbox would affect every custom sidebar.

## Verify by hand

1. In a cmux terminal, start `claude` and send this as the first prompt: `**bold** [link](https://example.com)`.
2. Look at the agent's title in the sidebar. If the tab already has Claude's topic, rename the tab to the same text first: `! cmux rename-tab "**bold** [link](https://example.com)"`.

| You see | Meaning |
|---|---|
| The literal text, with `**` and brackets | Plain text. Nothing to do. |
| Bold text or a link | cmux renders Markdown. Don't click links in the sidebar, and open an issue here. |

## Development-time note

While building this, the coding agent tried to screenshot the sidebar to check the render. That needed Screen Recording for cmux, which was not granted. Nothing at runtime needs it. Don't grant cmux Screen Recording or Accessibility for this sidebar. Check the render by looking, or take a screenshot yourself.

## Reporting a problem

Open an issue on this repository. For something sensitive, contact the maintainer directly instead of filing a public issue.
