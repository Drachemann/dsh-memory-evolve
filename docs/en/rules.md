# Memory and review rules (functional guide)

This document describes the **behavior and rules** of dsh-memory-evolve: how memory is layered, how the in-turn review triggers and what it produces, what may enter memory or skills, and what needs your confirmation. It contains no implementation details; if you want the internals, read the code or the README configuration table.

---

## 1. The memory system: five tracks

The plugin maintains five tracks that do not contaminate each other. Each has its own write path and injection path:

| Track | What it stores | Who may write | Injected into sessions |
|---|---|---|---|
| **User profile `user`** | Who the user is, preferences, communication style, working habits | Only after the user **confirms** (confirmation by default) | ✅ Every session |
| **Global facts `memory`** | Environment facts, tool notes, technical conventions | Only after the user **confirms** | ✅ Every session |
| **Project key memory `key`** | **Long-term facts** about the current project (agreements, decisions, architecture, pitfalls) | **Model writes need confirmation** (each turn judges importance and submits a suggestion → queue → adopted) plus manual add in the Memory tab (direct write) | ✅ Sessions in the current project (isolated by cwd; **filtered by git branch**, and the current branch name is injected with the key) |
| **Project log `project`** | Agreements, progress and key decisions for the current project | The model **writes every turn** (no confirmation) | ❌ Not injected; read on demand |
| **Daily log `daily`** | What happened today and important progress | The model **writes every turn** | ❌ Not injected; read on demand |

### 1.1 Write paths

- **user / memory (global tracks):** in suggest mode the model — including the in-turn review — and subagents **cannot write directly**. They can only submit a suggestion to the pending-confirmation queue; you confirm it in the Memory tab on the conversation page (or with the `/memory_review` command) before it is written. This prevents unguarded self-modification: global tracks are injected into every session, so a mistake there has the widest reach.
- **key (project key memory):** the snapshot prompt asks the model to **judge** each turn whether an **important project fact** appeared — a long-term agreement, decision, architecture conclusion or pitfall that will remain valid across sessions. If so, it submits a suggestion for `target=key` (the pending queue; it is written and injected only **after you adopt it**, same as the global tracks); if not, it skips it. This is **not a running log**; not every turn needs a key write. You can also add an entry manually with the input box on the **Project key memory KEY.md** tab (you are the confirmer, so it is a direct write). Key entries archive to the project's `KEY-archive.md` (kept with the project); archiving and promotion preserve the branch marker.
- **project / daily (log tracks):** the snapshot prompt asks the model to finish each turn in two steps: (1) send a separate message containing only the write tool call (**no prose**); (2) send the full reply in the next message (**no tool call, ending the turn**). It must not put the full reply and the write call in one message, because a message with a tool call cannot end the turn. **At the end of every turn** it must use the memory tool to write **one entry each** to daily and project for the turn's progress (one or two concrete lines; do not add a time or date prefix — the program stamps the accurate timestamp), then call `memory_review_status` (action=check) to see whether a review is due. These writes need no confirmation; they are not injected, so low-quality content only consumes file space and carries little risk.
- Three independent switches control this behavior (Memory Evolve settings → Configuration; all on by default). Turning a track off means the snapshot prompt no longer asks for writes to it (only the on-demand read hint remains); the model can still write when you explicitly ask.
- You can also tell the agent "remember X" directly; it writes according to the target track's rules.

### 1.2 Injection and caching

- **Only slow-changing tracks are injected:** user / memory (content changes only on confirmation) and key (written only when an important project fact appears, so it is low-frequency and stable). The snapshot ends with a fixed line asking the model to write one entry each to project/daily and to judge whether a key write is needed and whether a review is due, but the **content** of project/daily is not injected.
- Reason: DSH's context snapshot is append-only. When injected content changes, a new snapshot is appended and the LLM prefix-cache hit rate drops. project/daily change with every turn's writes, so injecting them would break the cache every turn; they are read on demand. **key is as low-frequency as the global tracks** and is injected with "live read + change detection": when its content changes (a tool write or a manual add in the tab), the next snapshot's text changes and it is re-injected, exactly like the global tracks. **The prompt line itself is fixed text** (it does not vary with content), so it creates no new snapshots.
- Known limitation: even with only slow tracks, **any confirmed write** (or a direct `memory add`) still triggers a snapshot update and truncates the prefix cache. The more often you write, the less cache benefit remains. This is inherent to DSH's core mechanism.

### 1.3 Entry format

- Every entry has a time prefix: global tracks and project key memory use `[YYYY-MM-DD]`, the project log uses `[YYYY-MM-DD HH:MM]`, and the daily log uses `[HH:MM] [project]` (the file name already contains the date; the program fills in `[project]` from the session working directory, so the model does not write it). **In a git repository, project and daily logs also carry a branch tag automatically:** `[HH:MM] [git main] [project] content`, `[YYYY-MM-DD HH:MM] [git main] content`. The branch is read live (`git branch --show-current`); outside a git repository or when the read fails, no tag is added. Any hand-written prefix (date or `[git …]`) is stripped by the program — tags are program-owned annotations that make logs traceable to a branch and cross-branch memory reliable.
- Project memory (key and project) is isolated by **working directory**: each directory has its own files, so a session in project A cannot see project B's memory (key is injected only into sessions in its own directory; project memory can only be read on demand from its own directory).

### 1.4 Letting the model read and write project/daily memory proactively

The snapshot's **on-demand memory** hint already contains the trigger conditions. It tells the model: when the task involves project context or you are unsure about the project, read `target=project` first; when the user asks what happened today or needs today's information, read `target=daily`; do not guess. Project key memory (`target=key`) is already injected, so it does not need a read. The same hint asks the model to **write at the end of every turn** and to **judge whether a key write is important** (see 1.1). No extra usage guide is needed; the plugin works proactively by default.

The **timestamp is generated by the program**: the model is not told the current date and may not write a date prefix (the prompt forbids it, and the program strips a hand-written prefix before stamping the standard one), so the daily `[HH:MM] [project]`, project `[YYYY-MM-DD HH:MM]` and project key `[YYYY-MM-DD]` formats stay consistent and accurate.

`memory list` supports `filter` (keyword), `since`/`until` (date range; daily can search historical files), `recent` (newest first) and `limit` (maximum entries). **If nothing matches, or an old-format entry has an unparseable date, the result reminds the model to drop the filters and read the full text to verify.** Old-format entries do not participate in date filtering but are returned unchanged, never deleted by mistake.

"Write every turn" can be disabled per track (three switches under Memory Evolve settings → Configuration, all on by default). When a track is off it falls back to pure on-demand reading (for key, only manual add and read remain), and the model is no longer asked to write it every turn.

Optional: if you want the model to also know that the plugin is installed, or to add a personalized note, put a short note in global memory (MEMORY.md). It is not required.

### 1.5 Git branches and memory

Different git branches of the same project (the same working directory) can be logically different. Project-level memory is **branch-aware throughout** so memory does not leak between branches:

- **Current branch detection:** the program runs `git branch --show-current` live (the same approach as the DSH TUI, with a 1 s timeout). **Outside a git repository, on failure, or on a detached HEAD with no branch name, the branch is treated as "none"** — branch behavior degrades to "all" and never loses memory.
- **Key injection by branch scope:** a key entry may carry a `[branch:main,dev]` marker limiting the branches where it is visible. **No marker means all branches** (visible everywhere; historical entries naturally behave this way). Injection includes only entries with no marker plus entries whose marker covers the current branch; **the current branch name is injected with the key** (the key section title "Current branch: main" and the hint line "Current git branch: **main**"), so the model knows which branch it is on.
- **Scope semantics:** "all" and specific branches are **mutually exclusive, and "all" has the highest weight** (checking "all" clears the branch selection). Multiple branches are a comma-separated list (A and B). After a branch is renamed or deleted, entries with the old marker become dead data (never injected) and can be edited or deleted manually.
- **Scope management:**
  - Memory tab → KEY tab: each key shows a **Branch: all ▾ / Branch: main,dev ▾** badge; click it to open the multi-select (saving rewrites the marker precisely through `/api/key/scope`; "all" removes the marker). You can choose a branch scope when adding manually; a non-git repository shows only "all".
  - LLM tools: `memory add target=key … branches=main,dev` (default all; **a branch that does not exist yet only warns and is still written**, because it may be created later); `memory list target=key branch=main` queries the entries visible on that branch.
- **Log branch tags (provenance):** every project-log and daily-log entry **automatically carries a source branch tag** `[git main]` (daily: `[HH:MM] [git main] [project] content`; project: `[YYYY-MM-DD HH:MM] [git main] content`). The program stamps it live and **the model cannot write it** (a hand-written `[git …]` prefix is stripped), so logs are traceable to a branch and cross-branch review cannot mix them up.
- **Switch:** `keyBranchFilter` (default `true`, config.yaml only). When off, key is injected without filtering (everything is injected and no branch name is added).

---

## 2. In-turn memory review

> **Responsibility boundary:** project/daily writes are **done proactively by the main session every turn**, and key writes are **judged by the main session for importance** (see §1.1). **The review does not handle them.** The review focuses only on **global-track (user/memory) suggestions** and **skill creation/improvement** — the "distill and evolve" work, separate from the "running log".

### 2.1 Trigger and execution

| Step | Description |
|---|---|
| **Turn counting** | The plugin counts user turns per session (`agent/settled`, message turns only; retries, system injections and subagent sessions are not counted). The count **only increases; it is not cleared** |
| **Due** | When the count reaches `reviewInterval` (default 5), a review is marked **due**. The due state persists until the model actually completes the review, so a missed turn is not lost and the next turn is still due |
| **Check** | The snapshot carries a fixed hint section asking the model to call `memory_review_status` (action=check) before ending each turn. **The due decision comes from the tool's `due` result** (the interval is not hard-coded in the prompt, so changing it does not break the cache). **When due, a prominent warning appears at the end of the snapshot**, and the model must run the review and complete it. Note: the warning appears and disappears with the due state, and after `complete` the changed snapshot text triggers one extra context re-injection (two per cycle). **This is a feature, not a bug**: it ensures even a weak-following model receives the reminder. Suggested content stays in the pending queue until confirmed and never enters injection |
| **Execution** | When due, the model runs the review **silently inside its own turn** (all tool operations, not part of the final reply): global-track suggestions → skill operations → `memory_review_status complete` to reset the count |
| **Reset** | Only `complete` clears the count; calling `complete` when not due has no effect (it does not reset) |

### 2.2 The review uses the full context

- The review is **executed directly by the main LLM**, which holds the entire session context (conversation, tool output, reasoning, details). It needs no transcript summary, no subagent and no deep-read interface; no information is lost.
- Global memory (MEMORY.md/USER.md) is already injected in the snapshot, so the review can check for duplicates against the snapshot directly without attaching the full text again.

### 2.3 Tools used by the review

- `memory_review_status`: check whether due / reset after completing the review;
- `memory_suggest` (suggest mode): submit global-track suggestions (never modifies memory directly);
- `memory` (auto mode): write the global tracks directly;
- `skill_manage`: create/improve skills (create goes to the pending-confirmation queue by default).

### 2.4 Dependencies and cost

- The review is **prompt-driven**: the plugin counts turns and marks due; **execution depends on the model's instruction-following ability**. A weak-following model may not check when due, or may check but not execute (see §8 for the consequences).
- The review runs synchronously inside the turn: the response of a due turn is slightly slower (one check plus several tool calls). Discipline keeps it small (≤2 suggestions + ≤1 skill operation).

---

## 3. Review output rules (what should and should not be remembered)

> The review handles only **global-track suggestions** and **skills**. project/daily are written by the main session every turn, and key is judged for importance (see §1.1); they are outside the review's responsibility.

### 3.1 Global tracks user / memory (strict; prefer nothing over noise)

Only the following may be suggested (and even then they still need your confirmation after entering the queue):

- **Stable** personal information, preferences and communication/working style the user reveals (they must be reusable across sessions; **a one-off behavior is not a preference** and needs at least two independent signals);
- Non-trivial, **stable** environment or technical facts.

**Explicitly discouraged content:**

- Content **duplicated** in existing memory (global memory is already injected in the snapshot; the review checks duplicates directly);
- **Reusable procedures** — that knowledge belongs in a **skill**, not global memory;
- Descriptions of the **current state** of code or configuration — code changes quickly and such descriptions go stale (a future session would receive an outdated "fact");
- One-off task narratives, transient errors, negative assertions about tools, secrets and other sensitive information, and temporary states that a retry fixes.

When the same preference appears over several turns, **merge it into one suggestion**; do not split it.

### 3.2 Skills (strict creation + user confirmation)

Skills are injected into **every session's** system prompt (the skill directory is injected in full), so each additional skill adds context and affects the cache:

- **Creation bar:** create a skill only when all three hold: (1) repeated attempts still struggle to solve it (recurring pitfalls); (2) it is genuinely difficult and non-obvious; (3) it is likely to be reused many times. **One-off and simple tasks do not get a skill**; if you cannot think of a class-level name, it should not be created.
- **Improving an existing skill is exempt:** if an existing skill lacks a step or is outdated, improve it at any time (read it first).
- **Confirmation:** by default a newly created skill enters the **pending-confirmation queue** (`pending-skills`) and is not injected into any session. After you **adopt** it in the **Pending skill suggestions** section of the Memory tab, it enters the skill library and takes effect (adoption = moving the file, immediate). **Rejecting** deletes it.
- Skill names must be kebab-case class-level names (such as `systematic-debugging`); one-off task names (such as `fix-pr-123`) are forbidden.

---

## 4. Confirmation overview

| Content | Queue | How to confirm | When it takes effect |
|---|---|---|---|
| Global memory suggestions (user/memory) | `SUGGESTIONS.jsonl` | Adopt/archive/reject one by one in the Memory tab, or the `/memory_review` command | On adoption it is written to the matching memory file and injected with the snapshot on the next request |
| New skills (default) | `pending-skills/` directory | Adopt/reject in **Pending skill suggestions** in the Memory tab | Adoption moves it into the skill library and all sessions load it immediately |
| Todo suggestions (todo-life/work/project/daily) | `SUGGESTIONS.jsonl` (`target=todo-*`) | Adopt/archive/reject in the Memory tab | On adoption it is written to the matching todo track file (todos you dictate are written directly, without the queue) |

Supporting mechanisms:

- **Suggestion frequency:** when the same content is suggested repeatedly, the queue keeps one entry and increments "suggested N times" (the list is sorted by frequency, high frequency first). A recurring signal is likely worth confirming.
- **Archive (third-tier storage):** a suggestion that is not good enough for main memory but too valuable to lose can be **archived** to `MEMORY-archive.md` / `USER-archive.md` (§ format, one file per original target, with the reason). It is **not injected into any session**; the Archive tab in the Memory tab (or `/memory_review archive`) can **promote it back to main memory** (writing it to the matching main track) or delete it. If archived content is suggested again by a later review, it re-enters the queue automatically.
- **Edit before adopting:** a global-memory suggestion can be edited before adoption; only the edited text is written.
- **Automatic-sedimentation switches:** `reviewMode=auto` (write global memory directly, without per-item confirmation) and `skillReviewEnabled` (create skills automatically, without confirmation) are **both off by default** (suggest + confirmation). Enable them explicitly; once on, review output takes effect directly — be aware of the prompt-injection risk.

---

## 5. Todos (dtodo)

The **Todos** sub-tab of the conversation-page Memory tab and the `dtodo` tool provide four-track todo management, isomorphic to memory:

- **Four tracks:** `life` (`TODOS-life.md`) · `work` (`TODOS-work.md`, cross-project) · `project` (`projects/<hash>/TODOS.md`, **isolated by working directory**, so a session in project A cannot see project B) · `daily` (`daily/YYYY-MM-DD.todo.md`, one file per day, separate from the log files).
- **Storage format:** §-delimited MD files (exactly like memory; any editor or model can read them). The **file header is an HTML-comment format description** (the tag syntax is self-describing and stripped when parsing). The first line of each todo is metadata: creation time (stamped by the program), `[id: xxxxxxxx]` (unique identity; tools operate by id), `[q1]`–`[q4]` (four quadrants: important × urgent; default unclassified), `[due: YYYY-MM-DD]` (deadline; default none), `[status: pending|doing|done|blocked|cancelled]` (default pending), `[done: …]` (completion time, stamped by the program), `[cat: …]` (optional category). The body may hold multi-line details.
- **dtodo tool:** `add` (writes a todo you dictate directly; target defaults to project, or work without a cwd; quadrant/important/urgent/due/cat are optional) · `list` (**smart view by default**: overdue + due today + unfinished in the current project + unfinished global Q1/Q2, sorted and capped at 8, so the model sees only what matters; full results need `all=true` or status/quadrant/due filters; `date=` queries one daily file; **`past=true` queries past daily files** (before today, with dates, last), and by default **does not return expired leftovers** (unfinished with no future deadline); `expired=true` shows everything — past items stay out of the default view to avoid burdening the model; **`cwd=path` queries another project**: inspect `target=project` todos for a project from another session, locating the project track by that path; default is the current session directory) · `done` / `update` / `remove` (operate precisely by `id`, preventing accidental deletion by text matching; **past items' ids work too**, writing back to the matching date's file).
- **Write permission:** todos you **dictate are written directly** (you are the confirmer); todos the **model creates enter the pending-confirmation queue** (`memory_suggest target=todo-*`) and are written to the matching track after adoption — the model cannot assign work to you on its own.
- **Snapshot hint:** only one **fixed hint line** is injected (the text never changes, so it is cache-friendly): at the end of a turn, run `dtodo list` to check deadlines and remind the user in the reply if any are due, without expanding the whole list; use `dtodo list past=true` for past daily todos (not included by default, to avoid information overload). **Todo content is never injected** (same as project/daily; state changes create no tail injection).
- **Archive:** todo suggestions can be archived to `TODO-archive.md` (the entry carries an "original track" marker and is written back to the matching todo track on promotion). Completed todos remain in the file (`[status: done]` + completion time) and can be viewed or restored in the UI at any time.

---

## 6. Memory / Skills / Todos / Settings tabs (the only management entry point)

The conversation page has four tabs: **Memory / Skills / Todos / Memory Evolve settings** (`memoryTabEnabled` is **on by default**; it can be disabled in config.yaml — it is not a runtime-changeable item, and a disabled tab cannot be recovered from the UI). They are the plugin's **only management entry point** (the old settings-panel "memory management" was removed and its functions were folded into these tabs). When there are unconfirmed memories, skills or todos, the matching tab shows **🔴 a red dot + count**. Every tab has a **Guide** sub-tab: the settings tab's guide introduces **all plugin features briefly**, and the other tabs' guides describe **their own feature in detail**. The Memory tab's top row holds the feature sub-tabs and file tabs (separated by a vertical bar):

- **Feature tabs (Memory tab: Guide / Pending memory suggestions):** on the same row as the file tabs (vertical bar between them). **Guide** describes memory in detail; **Pending memory suggestions** is the suggestion queue (adopt/archive/reject, batch operations, edit then adopt). The overall guide and runtime configuration moved to the **Memory Evolve settings** tab (Guide = a short introduction to the whole plugin; Configuration = the former runtime-configuration form; saving applies immediately and persists).
- **Skills tab (Guide / Pending skill suggestions / Skill management):** **Skill management** is the full manager merged from the former dsh-skill-browser (browse/search, enable/disable, custom directories, file editing; see the README).
- **Todos tab (Guide / Pending todo management / Todos):** **Todos** is the four-track todo manager (see section 5).
- **View files:** global rules, long-term memory, user profile, project key memory, project log, daily log and archive files (read-only preview with the file path and a truncation notice). §-separated structured entries are shown as readable cards by default (time badge + content + project tag, with keyword search) and can switch to plain text. **A short line at the top of each tab explains what that memory is for and how it works.**
- **Manually add project key memory:** on the **Project key memory KEY.md** tab, an input box adds one long-term project fact (the program stamps the time and keeps the § format). You can **choose the branch scope** (all / multiple specific branches; mutually exclusive, with "all" having the highest weight; a non-git repository has only "all"); it is injected into the context on the next turn.
- **Branch scope (git repositories):** a key entry may carry a `[branch:main,dev]` marker limiting its visible branches (no marker = all). Session injection includes only entries with no marker or a marker covering the **current branch**, and the current branch name is injected with the key so the model knows where it is. Each key's **branch badge** can be clicked to change the scope (`/api/key/scope` rewrites the marker precisely; "all" removes it). LLM key writes can use `branches=main,dev` (default all; a nonexistent branch warns but is still written); `memory list target=key branch=main` queries the entries visible on a branch. `keyBranchFilter=false` (config.yaml) disables filtering.
- **Delete a memory entry:** in the card view each entry has a **Delete** button. A confirmation dialog warns that deletion is irreversible; after confirmation the host deletes by **exact full-entry text** (`removeExact`, whole-entry equality, not substring matching), so deleting a short entry cannot accidentally delete a longer entry containing it. If the file was modified externally and cannot be parsed, deletion is refused and the file is backed up; if the entry no longer exists, the UI reports it and asks you to refresh.
- **Main memory ↔ archive, both directions:** entries in the User profile / Long-term memory tabs can be **archived** (after confirmation they move from the main track to the archive file and are no longer injected; content is preserved verbatim). Entries in the Archive tab can be **promoted back to main memory** (injected again) or deleted — the full lifecycle is manageable inside the Memory tab.
- **No other editing:** the remaining memory files are §-separated structured entries; free-form editing on the page easily breaks the format and causes the memory tool to misread them. Use the memory tool (project/daily/key can be written directly; global tracks go through confirmation), or **Open file** and edit with a system editor.
- Every row has an **open with system tool** button.

---

## 7. FAQ

**Q: Why does memory in the session not change immediately after I confirm a suggestion?**
A: The write completes immediately, but injection happens in the context snapshot of the next request. A snapshot that is already rendered is not rewritten.

**Q: Project memory is not injected, so how does the model know about the project?**
A: Project **key** memory is injected into the current project session's context (the snapshot includes a "Project key memory" section). The snapshot also carries a fixed hint asking the model to check every turn: when the task involves project context, read on demand with the `memory` tool (target=project / daily); when a new fact worth recording appears, write it proactively (key is judged for importance). Both reads and writes are proactive model actions, with no review turn needed.

**Q: Why does skill creation need confirmation?**
A: Skills are injected into every session and persist for a long time, equivalent to modifying the "system prompt". By default they enter the pending queue so that only experience you endorse becomes a global skill.

**Q: Does the review see my sensitive information?**
A: The review is executed by the main session model itself, which already holds the full context (secrets and other sensitive content are not exposed any more than in normal conversation). The "do not sediment" list also forbids writing sensitive content to memory.

**Q: Why is the review "due" rather than "running every N turns automatically"?**
A: The review is now executed by the main LLM inside its own turn (no information loss, no subagent). The plugin only counts and marks due; the due state persists until the model truly completes it with `memory_review_status complete`, so a missed turn is not lost.

## 8. Known limitation: instruction-following dependency

"Write project/daily every turn, write key by importance" and "in-turn memory review" are both driven by **snapshot prompt sections**, so execution depends on the model's instruction-following ability:

- A weak-following model may skip the every-turn check, or not check when due, or not run the review. The plugin cannot force it (this is the inherent cost of a prompt mechanism, traded for information completeness and architectural simplicity).
- **The count is not cleared when due** mitigates a "missed turn" (the next turn is still due), but cannot save "never checks".
- If the model does not execute: lower `reviewInterval` to make reviews due more often, or turn off "write every turn" in Memory Evolve settings → Configuration to reduce noise.
