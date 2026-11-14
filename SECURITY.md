# Security

createdAt: 2026-11-13 23:55 EST
lastUpdated: 2026-11-13 23:55 EST

This project exists partly for security reasons. It shows agent state in cmux without adding anything that runs on every agent turn. This page records what was considered and why the design is what it is.

## Summary

| Question | Answer |
|---|---|
| Runs on every prompt or tool call? | No. No Claude Code or Codex hooks. |
| Background jobs? | No. No launchd agents, cron or daemons. |
| Network access? | No. The sidebar runtime has none, and the installer makes no requests. |
| Reads credentials or tokens? | No. |
| Writes files? | The installer writes one file. The sidebar writes nothing. |
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

- **Sandboxed by cmux.** No filesystem, network, timers or child processes. A watchdog stops runaway code.
- **Reads:** workspace titles, folders, branches, dirty state, and each agent's kind, status, times and title.
- **Actions:** only `workspace.select` and `surface.focus`, and only when you click a row. A test (`tests/view.test.mjs`) fails if any other cmux command appears.
- **No text fields and no clipboard.** It can't capture keystrokes or swap your clipboard.
- **No links.** It never calls `openURL`.
- **Untrusted strings are shown as plain text.** Branch names, folder names and prompts go through `Text`, which has no markup or link handling.

## What the installer does

`install.sh` is about 20 lines. Read it before running it.

- Writes `~/.config/cmux/sidebars/agents.js` and nothing else.
- Backs up a different existing `agents.js` first.
- No `sudo`, no network, no changes to `~/.claude` or `~/.codex`.
- `tests/install.test.mjs` runs it against a throwaway home folder and fails if any other file appears.

## Decisions

- **Reactive JS over interpreted Swift.** Same sandbox either way. JS was chosen for performance, not security.
- **Default in-process renderer.** cmux offers an out-of-process renderer (`"customSidebars": { "renderer": "remote" }`) for sidebars you don't trust. This one is small and yours, so in-process keeps hover and keyboard behavior. Switch to remote if you install a modified copy you haven't read.
- **No quotas.** Quotas need a token and a network call outside the sandbox. That is the one piece we chose not to own here.
- **No auto-update.** You update by pulling and rerunning the installer. Nothing fetches code on its own.

## Known exposure

- **Prompts on screen.** An agent's title is its first prompt. It shows in the sidebar, so it is visible when you share your screen.
- **cmux itself.** The wrapper and sidebar runtime are cmux's code, out of scope here. A bug in the runtime's sandbox would affect every custom sidebar.

## Development-time note

While building this, the coding agent tried to screenshot the sidebar to check the render. That needed Screen Recording for cmux, which was not granted. Nothing at runtime needs it. Don't grant cmux Screen Recording or Accessibility for this sidebar. Check the render by looking, or take a screenshot yourself.

## Reporting a problem

Open an issue on this repository. For something sensitive, contact the maintainer directly instead of filing a public issue.
