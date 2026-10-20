# COI scheduling (`de_coi`) guide

> The dsh-memory-evolve COI scheduling module dispatches tasks to external CLI agents (kimi / codex / grok / hermes or any custom CLI), with unified scheduling, live progress, scoped session management and memory-context injection.
> **Disabled by default:** first turn on **COI scheduling** under Memory Evolve settings → Configuration (tools take effect immediately; the tab appears after a refresh).

---

## 1. What this is

COI = a command-line AI agent. This module solves three pain points:

| Pain point | Solution |
|---|---|
| Calling through bash is a black box; progress is invisible | Background process + **live log stream** (GUI task detail + full-screen zoom) |
| Session recovery depends on remembering session ids by hand | **Automatic session-id capture**, scoped management, notes, one-click resume |
| A COI does not know your rules or context | **Memory-context injection**: pass long-term memory / user profile / project key memory to the COI (AGENTS.md is not included) |

## 2. Quick start

1. Turn on the switch (above).
2. Pick one of three entry points:
   - **Tell the AI:** "dispatch XX to kimi / have codex fix the tests" (the AI uses the `de_coi_dispatch` tool; completion continues automatically).
   - **Terminal:** `/de_coi run "task" --coi kimi`
   - **Web:** the **COI scheduling** tab on the conversation page → fill in the form on the Tasks tab.
3. Watch live progress in the task detail; the output is archived automatically, and a summary is sedimented into memory.

## 3. Core concepts

- **Adapter:** a declaration of "how to call a CLI" — command template, session-resume arguments, session-id extraction rule, suitable scenarios, associated skill.
- **Task:** one COI invocation with its own taskId, state machine (queued → running → completed/failed/killed/interrupted) and archived output.
- **Session:** a resumable COI-side session (session id) that exists across tasks.
- **Scope:** the ownership of a task/session, which determines visibility (see §5).

## 4. Adapter management (Adapters tab / `/de_coi adapters`)

### Four built-ins (work out of the box)

| Adapter | Suitable for | Session resume |
|---|---|---|
| `kimi` | Frontend/UI and interaction, image understanding (screenshots/photos), fast development | `-S <id>` / `-c` |
| `codex` | Complex logic and backend, test repair, code review, PRs/large changes | `exec resume <id>` / `--last` |
| `grok` | Quick Q&A, log/document summaries, medium tasks that need speed | `-r <id>` / `-c` |
| `hermes` | General agent tasks: file operations, network, multi-tool collaboration, message push | `--resume <id>` / `-c` |

### Actions on each card

- **🎯 Suitable scenarios:** click **Edit** to change them (the AI consults this when choosing an adapter; the `de_coi_dispatch` scenario description updates after a restart).
- **Skill:** click **Skill** to view/edit that adapter's SKILL.md (= the AI's usage guide, injected into the model context; it can be disabled in the Skill management tab).
- **Enable/disable:** turn an unavailable COI off proactively — AI dispatches are rejected with a hint to use another available item.
- **Test:** one-click configuration check (runs `testCmd`; the result appears in the task list).

### Custom adapters (add form)

| Field | Description |
|---|---|
| id / name | Unique identifier and display name |
| Type | `ai-cli` (supports session resume) / `plain-cli` (plain command, no session) |
| Executable / arguments | Command and argument template (`{task}` `{workdir}` `{model}` placeholders) |
| Skill name | Associated skill (optional): the AI learns to call this CLI from it |
| Skill content | If filled in, a SKILL.md is created automatically when the skill does not exist (frontmatter is completed automatically) |
| Suitable scenarios | Tell the AI which tasks fit this adapter |

> Skill format: SKILL.md's frontmatter must contain `name` and `description` (a missing one is an error); if there is no frontmatter it is completed automatically.

## 5. Session scopes (visibility)

> **Default scope = `session`** (private to the originating session; decided on 2026-08-07: the old `project` default made every session in the same workspace receive tasks/injections, and the AI often chose it by mistake). Use `project`/`global` explicitly when cross-session collaboration is needed.

| Scope | Who can see it (task list / session list / AI query) | Lifetime |
|---|---|---|
| Temporary `temporary` | **Only the session that created it** | One-off (used by adapter tests); **not stored in the session library, no summary**; archive kept for 90 days |
| Session `session` (default) | Only the session that created it | Resumable within the session (stored in the session library, summary sedimented) |
| Project `project` | **All sessions in the creator's workspace** (owned by the creating session's working directory; may carry a git branch). One workspace often dispatches tasks in several directories (for example dsh-virtual-platform dispatching fe-erp1.0); tasks dispatched across directories in the same workspace are visible there, and **other workspaces cannot see them**. Old tasks without a recorded workspace fall back to matching the task cwd | Long-lived across sessions |
| Global `global` | All sessions | Kept long-term |

- **Branch dimension:** project-level tasks/sessions may carry a git branch (isomorphic to the memory key track); resume filters by "project + branch".
- **Session notes:** name/tag a session (for example "Zhenjiang deploy - login module") and resume it by name.
- **Session export:** `/de_coi export <sessionId> --coi <adapter>` (kimi export / grok export / hermes sessions export).
- **Concurrency lock:** only one task may run in the same session at a time (prevents context cross-talk).

## 6. Task management (Tasks tab)

- **Dispatch form:** adapter, task content, scope, resume session (a dropdown of captured sessions, **filtered by adapter**), task template, relay reference (the previous task's output) and memory-context injection.
- **List:** search (content/task id), status icon, 40-character truncation (hover for the full text), vertical scrolling.
- **Detail:** status, elapsed time, **last-output time** (refreshed live while running, to judge liveness), task content (read-only, zoomable), live log (2 s polling + ⛶ full-screen zoom).
- **Actions:** stop (while running; confirmation dialog; `/de_coi stop` asks twice), retry (dispatch again in the same session), delete (with confirmation; not allowed while running).
- **Status judgment:** `running` means the process is alive; the timeout fallback is 12 hours by default (hours/minutes configurable on the Configuration page). **A last-output time that has not advanced for a long time, together with a duration far beyond expectations**, is suspicious; stop it manually.

## 6.5 Proactive notification (completion appears in the model context)

When a CLI task completes, its **result summary (the last 1 KB of output)** is injected into the main AI's context **before its next generation** (the snapshot's **COI task status** section: up to 3 running + 2 recently completed; the summary is wrapped in a code fence; a terminal task is **notified only once**):

- **How the mechanism really works (important):** injection happens before the model's **next generation** — the model "sees it automatically" only if it **keeps generating within the same turn** (continuing to wait/query/do other work). If the model **ends the turn** right after dispatching, the next generation waits for a user message, so the result is not processed automatically. The tool description guides the model accordingly: for fast tasks, close the loop with `de_coi_wait`; for long tasks, wait first to confirm the start, then **state honestly** when ending the turn that "send any message to see the result" (never promise "it will be handled automatically").
- **Inline restraint:** each line contains only **task id + adapter name** (not the user's prompt — privacy/business content is not injected into the model context; when the model needs it, `de_coi_status` returns the full task).
- **Summary source:** the last 1 KB of task output; the full output is archived in the task detail (`de_coi_status` can fetch it).
- **Output convention (appended automatically, ai-cli only):** at dispatch time, append to the task: "end the reply with a **Conclusion** section + give the absolute path of any interactive content to a file". This makes the summary equal the conclusion and keeps feedback effective and traceable. **Plain-cli commands are not AI and do not get the append** (structured output/scripts do not consume natural-language instructions).
- **Visibility:** same rule as the task list — temporary/session = the originating session, project = the creator's workspace, global = everyone; tasks from other workspaces are not injected.
- **Full loop:** the model sees the summary → for details, use `de_coi_status` / the GUI task detail to pull the full output.
- **Switch:** follows `coiEnabled` (when the module is disabled by default, nothing is injected and there is zero overhead).

## 7. Memory-context injection (`injectTracks` / `contextText`)

Pass DSH memory to the COI so it knows your rules and context (**not injected by default** — content is sent to an external COI service; mind privacy):

- **The injection tracks are chosen per dispatch** (`injectTracks`, decided by the AI each time): any of `memory` = long-term memory (global facts), `user` = user profile (your preferences), `key` = this project's key memory (isolated by cwd + git-branch filtering, same rules as DSH session injection). **AGENTS.md global rules are not injected** (they are the DSH main model's discipline and are not sent to an external COI).
- **⚠️ Scope is unrelated to injection:** scope determines only task ownership and visibility. **Any scope (temporary/session/project/global) can pass `injectTracks`**; the AI should not choose `project` just to obtain memory.
- **Custom text** (`contextText`): the AI may first read the project/daily log and compose a text block itself.
- **Oversize handling:** injected text ≤ 32 KB is inlined; larger text is written to a local file and the path is given to the COI (the AI CLI reads the file).
- **Recommendation:** for project development, inject at least `key` so the COI understands the project's agreements and context.

## 7.5 Image attachments (`attachments`, 260810 snapshot-image mechanism)

A dispatch may carry images ("send this screenshot to grok for analysis"). There are three attachment sources: `path` (local absolute path), `url` (http(s) remote, 30 s download timeout), or `attachmentId` (a session image reference, resolved from the ImageBlock of the originating session's user/message events; only images referenced in this session). Any invalid attachment rejects the whole task (no half-built task). The adapter image-support matrix:

| Adapter | Supported | How images are passed |
|---|---|---|
| codex | ✅ | Dedicated argument `-i <path>` (repeatable) |
| hermes | ✅ | Dedicated argument `--image <path>` |
| kimi | ✅ | The prompt includes the image's absolute path; the kimi agent calls its image-reading tool (verified) |
| grok | ⚠️ | The prompt includes the image path (the agent reads it; not verified yet) |
| zcode | ❌ | Text-only channel; dispatch fails clearly and suggests a supported adapter |
| qoder-cn / dsh | ❌ (for now) | Unconfirmed; unsupported by default and fails |

Attachment files are written to `<coiDataDir>/attachments/`; the task records attachment metadata (source/original/localPath/name/caption). The image-upload entry in the GUI dispatch form is planned for a later release.

## 8. Cross-COI relay and templates

- **Relay** (choose **Relay reference** at dispatch, or `refTaskId`): append task A's full output to task B — **across COIs** (for example codex writes, then kimi reviews). Output over 256 KB is written to a file with a tail preview.
- **Resume vs relay:** resume continues the context of the same COI session (the other side "remembers"); relay gives A's output text to B as a reference (across COIs; B "sees" it).
- **Templates:** four built-ins (review code / fix tests / summarize logs / architecture analysis) plus custom ones, dispatched with one click.

## 9. Notifications

`coiNotifyCommand` (Configuration page): run once when a task ends; placeholders `{taskId} {coi} {status} {summary}`.
Example: `hermes send --platform weixin "COI task {taskId} {status}"` (with the hermes gateway pushing to WeChat/Feishu).

## 10. Configuration

### Host configuration (`config` in `cordis.patch.yml`)

| Key | Default | Description |
|---|---|---|
| `coiEnabled` | `false` | Module master switch (disabled by default; the runtime configuration can toggle it) |
| `coiDataDir` | `<memoryDir>/coi` | Data directory (adapters/sessions/tasks/templates/archives/exports) |
| `coiSummaryEnabled` | `true` | Sediment a summary into project/daily memory when a task completes |
| `coiSyncSkills` | `true` | Sync built-in adapter skills to the skill library at startup (the source is in the plugin) |
| `coiNotifyCommand` | `null` | Completion-notification command template |
| `coiRetentionDays` | `90` | Archive retention in days (expired entries are cleaned automatically) |
| `coiTaskTimeoutMs` | `43200000` | Default task timeout (12 hours; the fallback line) |
| `coiMaxLogBytes` | `2097152` | Per-task archive limit (2 MiB) |

### Runtime configuration (COI scheduling tab → Configuration; applied immediately)

- Notification command, task retention days, task timeout (hours + minutes). Memory injection has no global default — each dispatch decides with `injectTracks` (an earlier default-injection switch was removed: it tempted the AI to choose `project` to obtain memory, and default injection carried a privacy risk).

## 11. Command reference (`/de_coi`)

```
/de_coi run "<task>" [--coi kimi|codex|grok|hermes] [--scope temporary|session|project|global]
                 [--session <id>] [--branch <b>] [--model <m>] [--ref <taskId>] [--template <id>]
                 [--continue] [--inject-tracks memory,user,key] [--context-text <text>]
/de_coi list [--coi <id>] [--status <s>] [--limit <n>] [--q <keyword>]
/de_coi log <taskId> [--tail <characters>]
/de_coi stop <taskId> [--force]        # stopping asks for confirmation; --all requires --force --all
/de_coi sessions [list|note <id> <note>|rm <id>] [--scope] [--branch] [--q]
/de_coi adapters [list|show <id>|test <id>|enable <id>|disable <id>]
/de_coi stats
/de_coi templates list
/de_coi export <sessionId> [--coi <id>]
/de_coi help
```

## 12. Tool reference (callable by the AI)

| Tool | Purpose |
|---|---|
| `de_coi_dispatch` | Dispatch a task (the description carries the currently available adapters and their suitable scenarios; supports session resume/relay/memory injection) |
| `de_coi_adapters` | Query available adapters, suitable scenarios and enabled state (check first when unsure before dispatching) |
| `de_coi_status` | Query task status/output summary/session id |
| `de_coi_wait` | Block until the task completes (get the result synchronously) |
| `de_coi_cancel` | Stop a task |
| `de_broadcast` | Session broadcast: messages between DSH sessions (send/list/read/delete) |

## 12.5 Session broadcast (messages between DSH sessions)

A lightweight sub-feature independent of COI scheduling: pass information from one session to one or more other sessions. The receiving AI **sees an unread hint before its next generation**:

- **Send:** the conversation header's **⧉ Copy session ID** button copies the current session ID → paste it into the target session's input and tell that AI ("summarize XX and send it to session `<ID>`, content: …") → that AI calls `de_broadcast send` (recipients is an array of session IDs; multiple sessions can be broadcast to).
- **Receive (targeted injection):** the snapshot's **Session broadcast** section injects the unread list **only into the recipient session** (inbox style: id + subject + sender + time; the AI can `read` directly without `list` first; the server filters by recipient, so other sessions see nothing). The snapshot does not inject message bodies (restraint) — the AI uses `de_broadcast read` for the full text.
- **Read means consumed:** a read marks the message read; **after all explicit recipients have read it, the message is deleted automatically** (one recipient = delete on read; multiple recipients read individually and the last read triggers deletion). The sender or anyone who can see it may also `delete` manually.
- **Rooms (chat rooms):** multi-session group chat — `room-create` (the creator joins automatically) → tell others the room id → `room-join` → when sending, pass the room id in recipients (`room-xxx` or `room:<id>`) → **all members receive it at once** (targeted snapshot injection). `room-leave` exits (the last member leaving deletes the room), `room-list` lists my rooms, `room-rm` dissolves it (creator only). **Members are session IDs, independent of working directories — naturally cross-directory collaboration.** The sender must be a member; room messages are shared discussion, so `read` does not delete them (they remain for review). **Automatic cleanup:** a room with no activity for 30 days (no messages/joins) is deleted together with its messages (run by the daily prune; activity or a join refreshes the timer).
- **Project group (`project:<path>`):** pass `project:/absolute/path` in recipients → every session in that directory sees it (matched by session cwd; not visible across directories; announcement semantics, `read` does not delete).
- **Default one-to-one:** the AI uses rooms/project groups only when the user explicitly asks (a tool-description constraint against accidental spread).
- **Presence:** `de_broadcast presence` — with a roomId, lists which members are online (`running` = generating, so a message is visible within its turn) and which have ended their turn (`idle` = waiting for the user, effectively offline; **do not wait for it blindly**). With a sessionId, queries one session; returns `lastActiveAt` so you can judge how long it has been idle (data from `agent/status` event listening; **the last-activity time is persisted** to `broadcast/presence.json` and survives a dsh restart; `unknown` = never active in this process).
- **System notifications (observable actions):** kicking (`room-kick`, creator) and dissolving (`room-rm`, creator) send a **system notification** to affected members (sender = system; the snapshot/panel shows "from system") — the kicked member/members learn on read, so actions never happen silently.
- **Soft delete (traceable):** dissolving = status `dissolved` (the record is kept 30 days for panel tracing); a dissolved room refuses joins/messages; the management panel can show dissolved rooms and their history.
- **Management panel tab "Session broadcast"** (supervisor view, follows `broadcastEnabled`): message inbox (all messages/full text/delete any message) + room list (members online 🟢/⚪, active/idle/dissolved, last activity) + kick/dissolve buttons (send system notifications) + copy my session ID. Management API: `/memory-evolve/api/broadcast/*`.
- **Session alias (friendly name):** the conversation header's **✎ Alias** button sets one (≤10 characters). The snapshot's **Your session** section injects the alias line (the AI knows its friendly name); the broadcast panel/snapshot/tools show **the alias first** (`alias (short ID)`, with the full ID on hover; without an alias, the short ID). Stored in `<memoryDir>/aliases.json` (a global property independent of module switches). API: `/memory-evolve/api/aliases`.
- **Long content:** over 8 KB is written to `broadcast/broadcasts/<id>.txt`; `read` returns the full text.
- **Cleanup:** automatic 30-day expiry (startup + a daily scheduled prune).
- **Storage:** `<memoryDir>/broadcast/broadcast.json` (messages) + `rooms.json` (room membership) (an independent directory; config `broadcastDataDir`). **Independent switch `broadcastEnabled`** (off by default; Memory tab runtime configuration "Session broadcast") — **it does not depend on the COI scheduling switch** and can be enabled on its own. Enabling adds the `de_broadcast` tool + the header's copy-session-ID button + the snapshot's "Session broadcast" section.
- **Boundary:** targeted snapshot injection means the other side sees it **before its next generation**, **not real-time IM** (real-time behavior during a long task depends on whether the other side waits/polls within its turn).

## 13. FAQ

- **A task stays `running` without moving?** Check the detail's **last-output time**: an agent thinking for a long time without output is normal; over 12 hours it is killed automatically. If it is genuinely stuck, stop it manually (stopping asks for confirmation).
- **A COI stopped working?** Disable it on the Adapters tab — AI dispatches are rejected with a hint to use another item.
- **The AI does not know which CLI to call?** The dispatch description carries the scenarios; when unsure, it first calls `de_coi_adapters`.
- **Will memory be sent outside?** Not injected by default; when injecting, the GUI shows a clear warning — be careful with sensitive tasks.
- **COI disappeared after a restart?** `coiEnabled` is disabled by default; turn it on under Memory Evolve settings → Configuration. Historical task data is still there.
