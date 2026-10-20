# Memory sync (cross-device project memory sharing)

> Share **project memory** (project KEY, project log, KEY archive, project todos) and **global memory** (global memory, user profile, daily log, life/work/daily todos) across machines — a conclusion written in the office is already there when you open the same project at home.

---

## What it is (30 seconds)

DSH memory lives on this machine under `~/.dsh/memories/` and normally belongs to this machine only. **Memory sync** reconciles a chosen project's memory with a Git remote, sharing it across devices:

- The local files are always complete: offline reads and writes work; sync only "batches a set and merges once".
- Only projects you opt in are synced (**per-project switch, all off by default**) — a project that was never enabled behaves exactly as if this module were not installed.
- Two devices **recognize each other automatically**: the same code repository URL means the same project, with no configuration.

## The three switches (enablement levels)

| Level | Switch | Location | Default | Effect |
|---|---|---|---|---|
| Module | Memory sync | Memory Evolve settings → Configuration | Off | Makes the Memory sync tab available. **It only reveals the module; no project starts syncing.** |
| Project | Sync this project | Memory sync tab | Off | Whether the current project participates. On = initialize and start reconciling; off = stop for this project (memory stays complete locally). |
| Track | Sync scope: project memory track | Memory sync tab | On | Whether project memory (KEY + project log + archive + project todos) participates. Global memory has **four separate track switches** (global memory / user profile / daily log / todos, in the Global memory sync section of the tab; **available only with a shared memory repository**, off by default). |

A project without **Sync this project** enabled gets no Git repository, no entry identities, and a disk state byte-identical to a machine without this module.

## Choosing the memory remote

Memory sync is **one memory remote + one dedicated branch per project** (`dsh-shared/<project identity>`, named automatically and identically across devices). There is one config value (zero-config by default):

| | Leave the address empty (default) | Enter a shared memory repository address |
|---|---|---|
| Memory remote | **Your main code repository** (dedicated branch, no code pollution) | **Shared memory repository** — a private repository that holds memory for every project |
| Project memory | ✅ Synced (dedicated branch) | ✅ Synced (dedicated branch, automatically stored there) |
| Global memory | ❌ Unavailable (global memory belongs to no project; the main code repository cannot hold it) | ✅ Available (one namespace branch per track, independent switches) |
| Privacy | **A public code repository means public memory** | Memory is fully separated from code |
| Legacy config | The v1 branch (`dsh-shared/memory` / `main`) is detected and reused with no migration | Same |

**How to choose:** if the code repository is private, leave everything empty and click **Start sync**. If the code is public (open source on GitHub, for example) or you want memory managed separately, enter a shared memory repository address (one repository holds every project's memory). The tab's Operations section has the full collapsible explanation, and the status card shows which kind of memory remote is active.

**Switching the memory remote:** local memory is always the complete source of truth; switching only changes what it reconciles against. If you enter a shared repository address, this project's memory merges into its dedicated branch there; clearing the address returns it to the main code repository. The old branch is left in its original repository as an archive; you must explicitly confirm before cleanup.

## Global memory sync (shared memory repository only)

**Global memory** (global MEMORY.md / user USER.md / daily `daily/*.md` / todos `TODOS-life.md`, `TODOS-work.md`, `daily/*.todo.md`) belongs to no project — syncing it across devices needs a **dedicated home**: a shared memory repository (initialized automatically once the Memory sync tab has an address; an independent Git repository at the memory root holds only global memory files).

- **Four independent track switches** (off by default, opt-in): global memory / user profile / daily log / todos — enable only the ones you want. Each track has its own namespace branch (`dsh-shared/memory-global` / `user` / `daily` / `todo-global`) and they do not interfere.
- **Sync:** in the Global memory sync section of the Memory sync tab, click **Sync** or **Sync and push** (a push always needs your explicit action).
- **Projects without a shared repository address:** the global section does not appear (global memory stays purely local, exactly as without this module).
- When sync is enabled, legacy global entries such as the daily log receive a deterministic entry identity based on their content (the same content yields the same ID on both devices, so the merge aligns).

## Everyday use

### Use the GUI (the only path — memory sync is manual in the tab; AI commands were removed on 2026-08-13)

The **Memory sync** tab on the left of the conversation page:

- **Status card:** project identity, memory remote type (main code repository / shared memory repository), remote branch, N uncommitted entries, M behind the remote, K conflicts, and a prompt for an old directory that needs migration.
- **Action buttons:** Start sync (code repository, zero config), enter a shared memory repository address (optional), Sync (fetch and merge), Sync and push (**a click is your explicit consent to push**), Disable this project.
- **Conflict list:** appears when two devices changed the same memory. Each item shows three versions (common ancestor / local / remote); choose **Keep local / Keep remote / Keep both**, and the resolved result is committed automatically.

## How it works (short version)

- Memory writes still land on disk in real time and **never touch Git** — sync is "batch a set and merge once", with no write latency.
- Every sync: **fetch the remote → three-way merge in memory (common ancestor / local / remote) → atomic write-back → two-parent commit**. Merge rules: additions from either side are kept; a one-sided change is taken automatically; only a change to the same entry on both sides goes to manual resolution. **Git conflict markers never appear in memory files.**
- The entry identity (`[id:xxxx]`, invisible in the UI) is the anchor for cross-device merges. Legacy memories get one deterministically when sync is enabled — the same old memory receives the same ID on both devices, which is what makes alignment possible. Project todos use their own tag id (`[id: xxxx]`), and the merger aligns by that id too.
- Network operations (fetch/push) run in a separate child process with a timeout, so a missing credential cannot hang the turn. Merge writes and memory writes share one lock; an interrupted write is recovered on the next sync.

## Safety guarantees

- The memory mechanism is unchanged; sync is purely additive.
- Code branches and history are untouched (memory lives on the dedicated `dsh-shared/<project identity>` branch).
- An accidentally deleted memory directory can be recovered from Git history; two projects cannot leak into each other (remote identity check + branch decisions use only `PROVENANCE.projectId`).
- **A push always requires your explicit action** (a GUI button click); there is no automatic push.
- Disabling sync deletes no data and can be re-enabled at any time; switching the memory remote deletes no data and archives the old branch.

## Known boundaries

- One repository (including a monorepo) shares one project memory; there is no subdirectory-level split (an override can be added in a later release).
- The v1 legacy branch (`dsh-shared/memory` / `main`) is detected and reused; new projects use the dedicated branch.
- Cross-device sync of global memory (user profile / daily log / prompts and so on) is a later release and works only with a shared memory repository.
- Local-path remotes such as `file://` cannot be shared across devices (they fall back to local-only).
- With no address, memory follows the code repository: a public repository means public memory (use a shared memory repository to isolate it).
- Changing the main repository's remote URL changes the project identity, so the old memory directory becomes an orphan (the Memory sync tab can show the old directory and migrate it; automatic merging comes later; old identity directories from before the change need manual handling).
- No git, or git older than 2.28: the code degrades gracefully and reports the reason with guidance when syncing.
- **Windows line endings (autocrlf):** Windows Git converts LF to CRLF by default, which breaks the memory entry delimiter. The memory repository ships `.gitattributes` (`* -text`) and a repository-level `core.autocrlf false` to force LF (written at initialization and propagated with the repository). Repositories that already contain CRLF are normalized losslessly on the next sync; no manual work is needed.

## Planned for a later release

- Scheduled automatic sync (configurable interval); automatic push (with a switch).
- Tombstones for deletions (delete operations converge across devices).
- A pre-push hook that can check for unpushed memory before a code push.
- An inline status line in the Memory tab.
