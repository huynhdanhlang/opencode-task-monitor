# OpenCode Task Monitor

A small **OpenCode V2 CLI-only plugin** for supervising long tasks: running agents and their current tool, owned background commands, pending responses, and a checklist read from your existing plan. It leaves the native sidebar, context usage, MCP controls and other plugins intact.

**Pre-release:** core projections and native rendering are verified; the interaction/host-version limits below are intentionally explicit. This is a source-installable GitHub plugin, not an npm publication.

## Install

Tested with **OpenCode 2.0.22**. This uses V2 CLI APIs; V1 is not supported. No server plugin, build, package manager install or model is required.

```sh
git clone https://github.com/huynhdanhlang/opencode-task-monitor.git "$HOME/.config/opencode/cli-plugins/task-monitor"
```

Add an entry to the existing `plugins` array in `~/.config/opencode/cli.json`; **preserve your other entries/settings**. Replace the example absolute path with the clone location:

```json
{
  "plugins": [
    { "package": "/home/YOU/.config/opencode/cli-plugins/task-monitor", "options": { "locale": "en" } }
  ]
}
```

Use `"locale": "vi"` for Vietnamese. Reopen the CLI if needed; no server restart is required. `/monitor` or **Open monitor** in the command palette opens the panel even when a narrow terminal hides the sidebar.

The plugin **does not change permission settings**. To use native permission prompts instead of autoaccept, separately set `"session": { "permissions": "prompt" }` in `cli.json`, keeping other session preferences. Existing allow/deny rules and saved permissions still apply. `OPENCODE_CLI_CONFIG_CONTENT` overrides file preferences, including plugin arrays and permissions.

## Link the current task's plan

The plugin never guesses a checklist from old chat or creates a second task database. Configure an exact session-to-plan reference in the plugin's `options`:

```json
{
  "locale": "en",
  "plans": [
    {
      "sessionID": "ses_YOUR_SESSION",
      "directory": "/absolute/server/project",
      "path": "docs/superpowers/plans/my-plan.md"
    }
  ]
}
```

The directory belongs to the **connected server**, not necessarily your terminal machine. The path must be one file directly under `docs/superpowers/plans/`; traversal and arbitrary file paths are rejected. Add the session's existing plan reference, not a copy of the plan. No plan link means no sidebar checklist, not invented progress.

Supported source format:

```markdown
## Task 1: Investigate the owner
## Task 2: Implement the change
## Execution checkpoint
- [x] Task 1 complete.
- [-] Task 2 in progress.
```

Top-level task summaries own displayed status. Nested step checkboxes and prose are not interpreted as completion. Unmarked tasks remain pending. Refresh updates the source; terminal execution outcomes also refresh it. The plugin never writes your plan.

## Interaction and safety

- Click an agent to open its exact native session. Its title describes the job; a cached running tool is shown when known.
- Pending requests open the owning native session. The plugin never replies, approves, or saves permissions.
- Command output is fetched only when requested, as an **8 KiB snapshot**, not a follow stream. Output may contain sensitive process data; nothing is logged or persisted by the plugin.
- The panel provides Refresh and a keyboard action chooser. Interrupt is only for an active OpenCode execution, not an independently running shell. Confirmation names the exact session; membership, selection and activity are checked again before one native interrupt request. It does not undo files or data.
- Counts and rows represent loaded family records, not every historical agent. Unrelated sessions in the same directory and shells without verified `metadata.sessionID` are excluded.
- At most two plugin-originated reads run concurrently. Event-driven metadata refresh does not reread plan documents for streamed text. There is no polling loop, model call, daemon, task engine or project-write tool.

An optional `projectDirectory` adapter reads the existing AI Motion Video Roadmap/checkpoint through the server. It is disabled by default, exact-directory matched, and collapsed in the panel. This adapter grants no product acceptance or release authority.

## Compatibility and evidence limits

Native 2.0.22 captures have verified sidebar/checklist rendering, EN/VI panels at 80/120/180 columns, native action chooser registration/selection via native command dispatch, and server-backed owned output rendering. Pure tests cover ownership, interruption guards, Unicode/byte limits, source validation (including fenced examples), trailing terminal refresh, stale selection and output-view disposal.

Native permission/question response, confirmed interruption, full physical keyboard/pointer interaction and image rendering acceptance must be distinguished from unit tests or programmatic QA adapters. Do not interpret package availability as exhaustive host-version acceptance. The SDK's file reader buffers the response; the 128 KiB document limit is validated **after transfer**, not a network transport cap. Checkpoint text is limited to 24 KiB. Unsupported/malformed documents are unavailable, not truncated authority.

Current known limitations: a failed configured checklist can share the no-plan label; child tool text depends on its loaded message cache; omitted checklist items/source attribution are only available through the existing plan; OSC payload cleanup and multiline project-text sanitization need additional hardening. Keep project documents trusted. Physical PTY activation was not established reliably by the automated harness, so no blanket keyboard/pointer acceptance is claimed.

## Update, uninstall, tests

```sh
git -C "$HOME/.config/opencode/cli-plugins/task-monitor" pull --ff-only
```

Remove **only this package's entry** from `cli.json` to uninstall, then reopen the client. Keep unrelated plugins and the separately chosen `prompt` preference. Do not restore a whole old config over newer edits.

Pure tests require Node 24+ with native TypeScript support:

```sh
npm test
```

OpenCode supplies the runtime plugin/Solid/OpenTUI modules. A standalone Node import of `tui.tsx` is not a valid compatibility test. Native verification does not require launching a second OpenCode server.

MIT licensed. No credentials, user configuration, project documents, session dumps or QA captures belong in this repository.
