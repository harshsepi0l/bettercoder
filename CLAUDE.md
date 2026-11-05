# BetterCoder

A desktop app (Electron) that sits beside any IDE and **coaches** people to code: new, intermediate and senior. It **never writes their code**. It asks where they're heading, shows visuals, runs and animates their own code, maps their project and links official docs.

## Hard rules

- **No code for the learner, ever.** There is one mode and no switch: every reply is checked in full before it is shown (`src/main/core/guard.ts`). A reply with code is silently redone up to 2 times, then a fixed fallback is shown. Cards are checked too.
  - One exception: the lines of a `show_step` card allow language-neutral pseudocode (`←`, words, simple maths). `pseudocodeProblem` in `guard.ts` rejects real syntax.
  - Official doc examples: concept cards and Sources show a few lines of the official example, copied word for word (`engines/map/doc-examples.ts`). The app fetches them from an allowlist of official doc sites. They never come from the model, and the model never sees them.
  - Part labels (topics they're new to): the coach names parts it *expects* in a method's official line (`parts` on a `show_step` line, names or symbols only) with plain-word labels. The app finds them in the copied line (`shared/line-parts.ts`) and drops any that aren't there; the learner taps an underlined part to see its label.
  - Hidden examples: `animate_example` lets the coach write a small Python script that the animator runs (temp dir, same sandbox, works in idea sessions). Its code never leaves the main process: the trace goes out with `source: []`, `example: true`, and printed output or text values that look like code are refused. The player then shows only variables and output.
- **The learner's project is read-only.** Never write inside it. Tools are sandboxed (`core/paths.ts` rules, `adapters/fs-readonly.ts` gate): no path escapes, secret files refused, secrets redacted. The animator runs on a **temp copy** under macOS `sandbox-exec` (no network, no writes outside temp).
- **Licences.** Allowed libraries are MIT: pi-ai, pi-agent-core, pi-durable, chord.
- **No word or regex routing of what the learner types.** Buttons send structured intents (`CoachIntent`). Typed text goes to the model as is. Use library mechanisms (pi-durable hooks, `configure({modelTools})`) instead.
- **Sessions must never brick.** Recovery on open (`coach/coach.ts`); state is derived from the transcript (restart-safe).
- Keys and sign-ins live in the OS keychain (`adapters/keychain.ts`, main process only). Anthropic *subscription* sign-in is blocked by their terms; API keys are fine.
- Git repo: github.com/harshsepi0l/bettercoder (private), licence AGPL-3.0. Commit or push only when asked.

## The person you're building for

- They hate reading. Coach replies are a **bold headline (8 words max) plus at most 3 short bullets**, with cards over text.
  - One step is ONE card (`show_step`): the idea, then the pseudocode, then an optional question.
  - **Never checklists**, in cards or text. Old `steps` cards from past sessions render as plain numbered lines.
  - Step lines tagged with a method link to the official line. The learner picks how it shows (`codeView`): `highlight` (the line lit in its official example) or `stepper` (one line at a time). They pick it with visual previews in onboarding (its own step) and Settings › You, **never inside a session**. It defaults to highlight. The same choice sets how a hidden example's story shows in the animator: every step so far (highlight) or only the current one (stepper). Summaries to the user should be terse too.
- After every change, tell them **what changed in the code**, as a table: File | What changed (functions or components added, changed or removed; one row each). Keep it short, but never skip it.
- They watch token use. Keep context small: old tool results are stubbed, reads are capped (8 per message).
- After fixing a bug, add a regression test in `tests/` with a fixture.

## Commands

```bash
npm run dev        # run the app (electron-vite)
npm test           # tsx --test tests/*.test.ts (uses pi-ai's faux model, no network)
npm run typecheck  # tsgo (TypeScript 7) for main+preload and renderer
npm run ide:link   # dev install of the editor extension (symlinks ide/vscode into VS Code/Cursor/Windsurf), then restart the editor
```

Before saying something is done: `npm test` and `npm run typecheck` must both pass.

## Stack

Electron 45 (Node 24, `node:sqlite`), electron-vite, Vite, React 19, TypeScript 7 (`tsgo`; the classic compiler API is unavailable, so `ts5` = `npm:typescript@5.9` is used only for parsing in the Map), Tailwind v4, shadcn/ui (Radix), lucide, Geist fonts, React Flow + dagre (Map), Mermaid (diagrams).

- `package.json` is `"type": "module"`. The preload builds to CJS `index.cjs` (sandboxed). Main uses `import.meta.dirname`.
- Theme: Mantine-style dark greys with a maroon primary (`#8B1E2D`, lines `#C0394B`, text tint `#F1A2AB`). Use the tokens (`bg-chrome`, `border-divider`, `text-heading`, `text-brand-text`, `border-brand-line`), not hex values.

## Layout

```
src/
  main/
    index.ts              window, pin, ⌥Space, legacy "waypoint" data migration
    (clean layers: imports only point down; coach/ and services/ depend on ports/, never on adapters/, engines/,
     files, processes or Electron; tests/architecture.test.ts enforces all of it)
    core/                 pure rules, no Electron / pi / files
      guard.ts            no-code detection (StreamGuard, isCodeLine, pseudocodeProblem)
      paths.ts            isSecretPath, redactSecrets, SandboxError
      feeling.ts          stuck / ok / flowing from editor activity
      text-view.ts        notebook ↔ python views, line mapping
      editor-url.ts       vscode:// (cursor://, …) links for "Open in editor"
    ports/                interfaces only: ProjectFiles, Animator, CodeMapper, ProjectScanner, SessionStore, EditorFeed
    adapters/             the outside world (implements ports)
      fs-readonly.ts      resolveInside: the gate for every path into the learner's project
      providers.ts        pi-ai providers (all 42), settings.json (model, profile, skills)
      keychain.ts         keychain store (async safeStorage) over credential-store.ts (the encrypted file, testable)
      store.ts            projects + sessions (JSON + SQLite in userData)
      ide-socket.ts       editor link socket (~/.bettercoder/ide.sock)
    engines/              work the coach and tabs use (implements ports)
      project.ts          detectProject / detectFiles (any folder; git optional), SKIP_DIRS
      map/                code map: python-analyzer (ast), ts-analyzer (ts5), curly-analyzer (Java/C#/…), build-map, docs, doc-examples, code-skills
      visualize/          Python animator: runner (temp copy + sandbox, pythonFiles), tracer-source (sys.settrace), scenario
    coach/                the conversation
      coach.ts            pi-durable setup: extension (sections, tools, hooks), events → display, send/abort, recovery
      turn.ts             per-turn state from the transcript: intent tag, redo counts, read budget, typed tool names
      request.ts          each request: stubs, withheld code replies, the per-turn note, cache settings
      replay.ts           chat items, usage and last marked step rebuilt from the transcript
      prompts.ts          coach prompt, learner section + learner-now note, idea mode, intents, hidden redo messages
      tools/              read (list/read/search), cards (ask_question, show_diagram, point_to_code, show_step, animate_code), outline, skill (note_skill), progress (track_progress)
    services/
      workspace.ts        one live Coach per open session
      editor-link.ts      ties the editor to the open session: marker, meters, status line
      editor-context.ts   what the coach sees of the editor
    ipc/                  index.ts builds everything; ports.ts plugs the real ports in (realPorts, also used by tests);
                          one file per area (coach, workspace, editor, visualize, map, settings)
  preload/                exposes window.bettercoder / workspace / harness / visualize / codeMap
  shared/                 types and IPC channel names shared by main and renderer (profile.ts, harness.ts, workspace.ts, …)
  renderer/src/
    app.tsx               shell: onboarding → Home or session; sidebar toggle (⌘B)
    features/
      profile/            onboarding (style → code view → connect), profile editors, skills view, code view picker
      home/               Home: open folder/files, start from an idea, recent sessions
      shell/              title bar, sidebar + rail, session bar, tabs, composer
      coach/ visualize/ map/ sources/ settings/ workspace/ project/
ide/vscode/               the editor extension (plain CommonJS, no build): extension.js, ghost.js (pure, tested)
tests/                    *.test.ts plus fixtures/ (read-only sample projects)
```

## Data model

- **Project → Session → tabs (Coach, Visualize, Map, Sources).** Map belongs to the project; Coach and Sources to the session.
- Project kinds: `folder`, `files` (individually opened), `idea` (no folder yet, `root: ''`).
  - Idea projects get only the card tools that need no files (including `animate_example`).
  - **Link folder** gives the project a root; its sessions carry on.
- Stored in Electron `userData`: `projects/<id>/project.json`, `projects/<id>/sessions/<sid>.json` (meta), `projects/<id>/sessions/<sid>.sqlite` (pi-durable conversation, one file per session).
- Learner profile (`shared/profile.ts`): skills, style chips, and their own words (fenced in the prompt; it can never lift the no-code rule). Style and own words are a pi-durable section; levels and card use ride on the newest message as a "learner now" note (never stored). Both apply from the next message.
  - **Their level is never asked.** It is judged per language and topic (`new` | `basics` | `pro`), and only on evidence (`noteSkill`):
    - their code (`engines/map/code-skills.ts`, at most basics, only raises);
    - the coach's `note_skill` calls (one step at a time);
    - card use (`cardUse`, in memory per session, given to the coach as words).
  - Settings › You shows it as "Coach thinks", where the learner can correct or forget a topic (`by: 'you'`). Code evidence never overrides a correction.
  - `setProfile` never touches skills.
- **Prompt cache:** pi-ai folds every section into the top system message, so anything that changes mid-session must go on the newest message (like the editor view), never in a section. `tests/cache.test.ts` checks the real xAI body stays byte-for-byte; routing uses pi-durable's session id only (pi-ai sends it as `prompt_cache_key`; never add a second id like `x-grok-conv-id`), and every request asks for the long cache (`cacheSettings` in `coach/request.ts`).

## pi-durable notes

- `Harness.open(openNodeSqliteStorage(file), …)`.
- Hooks:
  - GenerationTask `beforeRequest` / `onYield`. `{ continue: string }` sends a hidden follow-up message.
  - ToolTask `beforeTool` / `afterTool`.
  - A round ends the run only if **every** call in it returns `control.terminate`. The coach records in `afterResponse` whether the round has `ask_question`, then sets terminate on every call of that round in `afterTool`.
- Sections are re-rendered on each request and patched into the transcript as `role: 'system'` entries. Tool declarations appear there as `toolsAdded` / `toolsRemoved` (tests read them from the faux request's `messages`).
- Hidden harness messages start with `[BetterCoder` and are never shown.
- `entries({ order: 'ascending' })`. There is no delete-conversation API; delete the session's SQLite files instead.

## Editor link notes

- BetterCoder and the editor are two apps side by side. The extension (`ide/vscode`) talks to the app over a Unix socket in `~/.bettercoder` (folder 0700), one JSON message per line (`shared/ide.ts`).
- The editor sends: hello, editor (file, cursor), doc (text), diagnostics, step_done. The app sends: anchor, clear, status.
- The coach sees the editor through `services/editor-context.ts`. It is added to the newest learner message on each request and **never stored**. The same rules as the tools apply: project files only, no secret files, secrets redacted.
- `show_step` takes `at` (file, line). The editor marks that line and shows the step's pseudocode as an `after` decoration, one line at a time (`ghost.js`). It is never inline-completion ghost text, because Tab would write it into their file.
- Meters: progress comes from `track_progress` (stored, so it is rebuilt from the transcript). Feeling comes from editor activity only (`core/feeling.ts`), never from what the learner types. Stuck shows "Get a hint" and a typed-out step shows "Next step"; both send existing intents.

## Animator notes

- Python only for now (code and hidden examples). Other languages need their own tracer: a later stage.

- The animator runs only Python and notebooks. It uses the nearest `.venv` / `venv` / `env` from the file up to the root, otherwise `python3`.
- Every folder from the file's folder up to the root goes on `sys.path`. Packages are loaded under their dotted name.
- A whole-file run executes `__main__`. `input()` stops cleanly.
- Notebooks run cell by cell: a cell that fails to parse is skipped and reported.
- Limits:
  - 400 steps.
  - The process is killed after 30s, or 45s on the first matplotlib run (it builds a font cache).
  - The tracer stops itself 3 seconds before that.
- The `is_user` check is cached per file, because a realpath on every call made torch imports 10× slower.
