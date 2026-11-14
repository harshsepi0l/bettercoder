# BetterCoder

A desktop app (Electron) that people write their code in (real VS Code in the Code tab, ▶ Run for every language) and that **coaches** them: new, intermediate and senior. It **never writes their code**. It asks where they're heading, draws ideas and their code on a whiteboard, runs their code, maps their project and links official docs.

## Hard rules

- **No code for the learner, ever.** There is one mode and no switch: every reply is checked in full before it is shown (`src/main/core/guard.ts`). A reply with code is silently redone up to 2 times, then a fixed fallback is shown. Cards are checked too.
  - One exception: the lines of a `show_step` card allow language-neutral pseudocode (`←`, words, simple maths). `pseudocodeProblem` in `guard.ts` rejects real syntax.
  - Official doc examples: concept cards, Sources and the editor's "See the official line" show the official example, copied word for word (`engines/map/doc-examples.ts`). The app fetches them from an allowlist of official doc sites. They never come from the model, and the model never sees them.
  - Part labels (topics they're new to): the coach names parts it *expects* in a method's official line (`parts` on a `show_step` line, names or symbols only) with plain-word labels. The app finds them in the copied line (`shared/line-parts.ts`) and drops any that aren't there; the learner taps an underlined part to see its label.
  - Whiteboard: `draw_board` lets the coach draw in steps (boxes with a name and a value, rows of cells, notes, arrows). The coach says only what is on it; the app places it (`layoutBoard` in `shared/board.ts`: boxes flow 3 to a line, each row of cells on its own line, notes wrapped at the bottom; old boards' grid positions are ignored). Every word on it goes through the no-code check; data values like `[1, 2, 3]` pass (`isDataLiteral`). Excalidraw draws it, read-only (`features/visualize/board-canvas.tsx`). Nothing runs: the old Python tracer is gone, and old `animation` cards show as one line.
- **The learner writes; the coach never does.** The learner writes in the Code tab's VS Code; the app itself writes nothing into their project. What reaches VS Code (`adapters/code-server.ts`, `adapters/editor-import.ts`) is held by `ipc/vscode.ts` alone, and the coach and services have no way to write (`tests/architecture.test.ts` enforces both). The coach, its tools and the services stay read-only: tools are sandboxed (`core/paths.ts` rules, `adapters/fs-readonly.ts` gate): no path escapes, secret files refused, secrets redacted. The coach never types in a terminal and never sees VS Code's own terminals. The coach never runs code; the learner's ▶ Run runs for real in their project.
- **Licences.** Allowed libraries are MIT: pi-ai, pi-agent-core, pi-durable, chord, node-pty, Excalidraw (the whiteboard; `scripts/copy-excalidraw-fonts.mjs` copies its fonts into the app, since the CSP blocks its CDN), and code-server (downloaded into `vendor/`, not bundled in git). VS Code extensions come from Open VSX only (Microsoft's marketplace is for Microsoft's VS Code).
- **No word or regex routing of what the learner types.** Buttons send structured intents (`CoachIntent`). Typed text goes to the model as is. Use library mechanisms (pi-durable hooks, `configure({modelTools})`) instead.
- **Sessions must never brick.** Recovery on open (`coach/coach.ts`); state is derived from the transcript (restart-safe).
- Keys and sign-ins live in the OS keychain (`adapters/keychain.ts`, main process only). Anthropic *subscription* sign-in is blocked by their terms; API keys are fine.
- Git repo: github.com/harshsepi0l/bettercoder (private), licence AGPL-3.0. Commit or push only when asked.

## The person you're building for

- They hate reading. Coach replies are a **bold headline (8 words max) plus at most 3 short bullets**, with cards over text.
  - One step is ONE card (`show_step`): the idea, then the pseudocode, then an optional question, and (when a run can show it) **checks**: the learner's Check button runs their file once per check with its inputs typed in (VS Code's "▶ Check" terminal) and the app grades it with fixed rules (`core/step-check.ts`: no crash, prints a number, shows / never shows words; typed input is taken out first), never the model. When every line passes, "Passed · Next step" asks the coach for the next one.
  - **Never checklists**, in cards or text. Old `steps` cards from past sessions render as plain numbered lines.
  - Step lines tagged with a method link to the official line. The learner picks how it shows (`codeView`): `highlight` (the line lit in its official example) or `stepper` (one line at a time). They pick it with visual previews in onboarding (its own step) and Settings › You, **never inside a session**. It defaults to highlight. The same choice sets how a whiteboard's story shows: every step so far (highlight) or only the current one (stepper). Summaries to the user should be terse too.
- After every change, tell them **what changed in the code**, as a table: File | What changed (functions or components added, changed or removed; one row each). Keep it short, but never skip it.
- They watch token use. Keep context small: every 4 learner messages old tool results are stubbed and old notes dropped, all at once (`TIDY_EVERY` in `coach/request.ts`); reads are capped (8 per message).
- After fixing a bug, add a regression test in `tests/` with a fixture.

## Commands

```bash
npm run dev        # run the app (electron-vite)
npm test           # tsx --test tests/*.test.ts (uses pi-ai's faux model, no network)
npm run typecheck  # tsgo (TypeScript 7) for main+preload and renderer
npm run vscode:fetch  # download code-server (pinned version, SHA-256 checked) into vendor/code-server: the Code tab's VS Code
npm run vscode:ext -- <ids>  # install Open VSX extensions into the app's VS Code (no ids: list them); never run code-server without --config
```

Before saying something is done: `npm test` and `npm run typecheck` must both pass.

## Stack

Electron 45 (Node 24, `node:sqlite`), electron-vite, Vite, React 19, TypeScript 7 (`tsgo`; the classic compiler API is unavailable, so `ts5` = `npm:typescript@5.9` is used only for parsing in the Map), Tailwind v4, shadcn/ui (Radix), lucide, Geist and Source Serif 4 fonts (OFL, bundled via fontsource), React Flow + dagre (Map), Mermaid (diagrams), Excalidraw (whiteboard).

- `package.json` is `"type": "module"`. The preload builds to CJS `index.cjs` (sandboxed). Main uses `import.meta.dirname`.
- Look ("Instrument", chosen 2026-11-14): one ground colour with **hairline borders, no filled panels**; tiny uppercase mono labels (`.bc-label`); serif titles (`font-serif`, Source Serif 4, used for step titles); red as the only accent. Two themes with the same look: **dark** = near-black with red (`#0F0F10`, maroon `#8B1E2D` buttons, lines `#C0394B`, small red text `#EC7480`), **light** = the same in daylight (off-white, white cards, maroon accent). Use the tokens (`bg-chrome`, `border-divider`, `text-heading`, `text-brand-text`, `border-brand-line`), not hex values: both themes define every token in `styles/globals.css`.
- Theme: the learner picks Dark, Light or "Match my computer" in Settings › You (`profile.theme`, with previews; never in a session). `features/settings/theme.ts` puts it on `<html data-theme>` and tells the main process (`IPC.setTheme`): the window's colours and VS Code's theme follow (`BetterCoder Dark` / `BetterCoder Light` in `ide/vscode/themes`, `withEditorTheme`: only while they are on one of ours). The whiteboard (`BOARD_THEMES`) and Mermaid diagrams read the theme too.

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
      traceback.ts        Python tracebacks: error type/message, frames, the learner's line to underline
      run-errors.ts       errors from every language ▶ Run handles (Node, .NET, Java, Kotlin, Swift, clang, crashes)
      error-words.ts      the plain-words line for a run's error (fixed templates, never the model, never code)
      runners.ts          ▶ Run: the command for each language, what it needs, official install links
      ai-extensions.ts    which editor extensions and settings are AI (same rule as ide/vscode/ai-block.js)
      editor-import.ts    "Bring your VS Code": what comes over, swaps, FORCED_SETTINGS (no AI, names-only autocomplete)
      jsonc.ts            VS Code's commented JSON
      task-check.ts       Check my answer: does their last run print the coach's answer (fixed rules, never the model)
      step-check.ts       a step's Check: grade one run with typed inputs (no crash, numbers, words), never the model
    ports/                interfaces only: ProjectFiles, CodeMapper, ProjectScanner, SessionStore, EditorFeed, Terminals
    adapters/             the outside world (implements ports)
      fs-readonly.ts      resolveInside: the gate for every path the coach reads in the learner's project
      providers.ts        pi-ai providers (all 42), settings.json (model, profile, skills)
      keychain.ts         keychain store (async safeStorage) over credential-store.ts (the encrypted file, testable)
      store.ts            projects + sessions (JSON + SQLite in userData)
      ide-socket.ts       the link to the BetterCoder extension in VS Code (~/.bettercoder/ide.sock); run commands → ipc
      editor-snapshot.ts  editor messages → EditorSnapshot (strict parsing)
      code-server.ts      the Code tab's VS Code: start/stop, secret cookie, stable port, forced settings, AI removal, installs
      editor-import.ts    "Bring your VS Code": reads VS Code/Cursor/Windsurf/VSCodium setups, checks Open VSX, copies over
      toolchain.ts        which compilers/runtimes are really installed (past macOS stand-ins), project files, temp build dir
      pty.ts              node-pty terminals for ▶ Run
    engines/              work the coach and tabs use (implements ports)
      project.ts          detectProject / detectFiles (any folder; git optional), SKIP_DIRS
      map/                code map: python-analyzer (ast), ts-analyzer (ts5), curly-analyzer (Java/C#/…), build-map, docs, doc-examples, code-skills
      python.ts           which Python: the project's venv or the system's (Map analyzer, ▶ Run)
    coach/                the conversation
      coach.ts            pi-durable setup: extension (sections, tools, hooks), events → display, send/abort, recovery
      turn.ts             per-turn state from the transcript: intent tag, redo counts, read budget, typed tool names
      request.ts          each request: stubs, withheld code replies, the per-turn note, cache settings
      replay.ts           chat items, usage and last marked step rebuilt from the transcript
      prompts.ts          coach prompt, learner section + learner-now note, idea mode, intents, hidden redo messages
      tools/              read (list/read/search), cards (ask_question, show_diagram, point_to_code, show_step, draw_board), outline, skill (note_skill), tasks (set_task)
    services/
      workspace.ts        one live Coach per open session
      editor-link.ts      ties the editor to the open session: marker, feeling, status line
      tasks.ts            a session's tasks: the learner's and the coach's, Check my answer, copies for Send
      editor-context.ts   what the coach sees of the editor
    ipc/                  index.ts builds everything; ports.ts plugs the real ports in (realPorts, also used by tests);
                          one file per area (coach, workspace, editor, code, vscode, map, settings); vscode.ts is the
                          Code tab's VS Code and the import; code.ts + code-area.ts + editor-runs.ts are ▶ Run
  preload/                exposes window.bettercoder / workspace / harness / codeMap / code / ide / editorImport
  shared/                 types and IPC channel names shared by main and renderer (profile.ts, harness.ts, workspace.ts, code.ts, ide.ts, editor-import.ts, …)
  renderer/src/
    app.tsx               shell: onboarding → Home or session; sidebar toggle (⌘B)
    features/
      profile/            onboarding (style → code view → your editor → connect), profile editors, skills view, code view picker, editor-import
      home/               Home: open folder/files, start from an idea, recent sessions
      shell/              title bar, sidebar + rail, session bar, sections.tsx (ModePanel), panel-tabs (narrow: Code | Coach), composer
      code/               the Code tab: vscode-frame.tsx (VS Code in a frame, "Pick a folder" for ideas)
      coach/              coach-pane.tsx (the coach beside VS Code: mode bar, then the one chat or a mode's view), mode-bar.tsx, chat, cards, ide-meter.tsx (hint / next step buttons)
      tasks/              tasks-tab.tsx (the Tasks mode, Ask about this, notifications over the coach), send-tasks.tsx
      visualize/          the whiteboard: board-player (steps, play), board-canvas (Excalidraw, lazy), board-elements (look, camera)
      map/ sources/ settings/ workspace/ project/
ide/vscode/               the BetterCoder extension inside VS Code (plain CommonJS, no build): extension.js, ghost.js, notebook-view.js,
                          ai-block.js (pure, tested), themes/bettercoder-dark.json
tests/                    *.test.ts plus fixtures/ (read-only sample projects)
```

## Data model

- **Project → Session.** A session is VS Code on the left and the coach on the right. The coach has **modes** at the top of its pane (`CoachMode`: Chat, Tasks, Visualize, Map, Sources). **There is one chat, and it shows only in Chat mode** (with the composer); the other modes fill the pane with their view and no chat. Asking from another mode (Ask on the Map, Get a hint on a task) sends with that mode as a `<bc-mode>` tag (structured UI state, like intents; Chat sends none) and switches to Chat, except Visualize, where the board lands in its view. The reminder tells the coach what they were looking at (`MODE_GUIDE` in `prompts.ts`). Map belongs to the project; Tasks and Sources to the session. Narrow windows: Code and Coach become two tabs.
- Project kinds: `folder`, `files` (individually opened), `idea` (no folder yet, `root: ''`).
  - Idea projects get only the card tools that need no files (including `draw_board`).
  - **Link folder** gives the project a root; its sessions carry on.
- Stored in Electron `userData`: `projects/<id>/project.json`, `projects/<id>/sessions/<sid>.json` (meta), `projects/<id>/sessions/<sid>.sqlite` (pi-durable conversation, one file per session).
- Learner profile (`shared/profile.ts`): skills, style chips, and their own words (fenced in the prompt; it can never lift the no-code rule). Style and own words are a pi-durable section; levels and card use ride on the newest message as a "learner now" note (never stored). Both apply from the next message.
  - **Their level is never asked.** It is judged per language and topic (`new` | `basics` | `pro`), and only on evidence (`noteSkill`):
    - their code (`engines/map/code-skills.ts`, at most basics, only raises);
    - the coach's `note_skill` calls (one step at a time);
    - card use (`cardUse`, in memory per session, given to the coach as words).
  - Settings › You shows it as "Coach thinks", where the learner can correct or forget a topic (`by: 'you'`). Code evidence never overrides a correction.
  - `setProfile` never touches skills.
- **Prompt cache:** xAI reuses a request only up to its first changed byte, so between tidy-ups every request must only grow. pi-ai folds every section into the top system message, so anything that changes mid-session goes on the newest message (like the editor view), never in a section; that note is then resent with its message unchanged (`SentNotes`, memory only). Never change the tool list mid-session (Visualize blocks other tools in `beforeTool` instead). About 1 request in 3 still misses on xAI's side (tested 2026-11-13, with or without `x-grok-conv-id`); `npm run check:session` measures it. `tests/cache.test.ts` checks the real xAI body stays byte-for-byte; routing uses pi-durable's session id only (pi-ai sends it as `prompt_cache_key`; never add a second id like `x-grok-conv-id`), and every request asks for the long cache (`cacheSettings` in `coach/request.ts`).

## pi-durable notes

- `Harness.open(openNodeSqliteStorage(file), …)`.
- Hooks:
  - GenerationTask `beforeRequest` / `onYield`. `{ continue: string }` sends a hidden follow-up message.
  - ToolTask `beforeTool` / `afterTool`.
  - A round ends the run only if **every** call in it returns `control.terminate`. The coach records in `afterResponse` whether the round has `ask_question`, then sets terminate on every call of that round in `afterTool`.
- Sections are re-rendered on each request and patched into the transcript as `role: 'system'` entries. Tool declarations appear there as `toolsAdded` / `toolsRemoved` (tests read them from the faux request's `messages`).
- Hidden harness messages start with `[BetterCoder` and are never shown.
- `entries({ order: 'ascending' })`. There is no delete-conversation API; delete the session's SQLite files instead. Clear chat (the composer's CLEAR, asks first) does exactly that: `clearChat` closes the coach, removes the files (`clearConversation`) and opens the session anew; its title and tasks stay.

## Code tab (VS Code) notes

- The Code tab is code-server (open-source VS Code, `vendor/code-server`), one server for the app on 127.0.0.1, opened on the session's project folder in a frame. It is the whole left side of a session; the coach pane (with its modes) is on the right; narrow windows fall back to two tabs. Idea projects show "Pick a folder".
- Locked: each start makes a random secret passed as code-server's `HASHED_PASSWORD`; the app adds the matching `code-server-session` cookie to its own requests to that port only (`ipc/vscode.ts`). Anything else gets the login page.
- Its data lives in `userData/vscode` (settings, extensions, `config.yaml`, `port.json`). The port is reused, because VS Code keeps window state in browser storage per address. code-server must always get `--config`, or it writes `~/.config/code-server`.
- Every start: `FORCED_SETTINGS` go back on (no AI, inline suggestions/inlay hints/snippets/tab completion off, the app's layout), AI extensions are removed (`core/ai-extensions.ts`: known list, AI/Chat category, own language models, inline-completion proposals; hooks for *other* AIs like `languageModelTools` are not AI), other extensions' title-bar Run buttons are hidden (`HIDDEN_RUN_BUTTONS`), and our extension is registered in `extensions.json` (a folder only linked in is "marked as removed").
- "Bring your VS Code" (onboarding step, Settings › Editor): settings (minus AI, secrets, managed keys), keybindings (minus AI commands), snippets, and extensions from Open VSX; Microsoft-only ones are swapped (`SWAPS`: Pylance → basedpyright, C# Dev Kit → muhammad-sammy.csharp, cpptools → clangd). A theme whose extension can't come stays BetterCoder Dark.
- The extension (`ide/vscode`) only connects when `BETTERCODER_EMBEDDED=1` (set by the app); installed in someone's own VS Code it does nothing. Inside, it also uninstalls an AI extension the moment it appears and puts locked settings back.
- It talks to the app over a Unix socket in `~/.bettercoder` (folder 0700), one JSON message per line (`shared/ide.ts`). VS Code sends: hello, editor (file, cursor), doc (text), diagnostics, step_done, step_typed, and ▶ Run's run / term_input / term_resize / term_stop. The app sends: anchor, clear, status, open ("Open in editor"; held until VS Code connects), term (run output and end), run_error (with an install link), problems.
- Notebooks are reported in the coach's own view (`ide/vscode/notebook-view.js`, kept identical to `core/text-view.ts` by a test): editor lines, markers and "Open in editor" lines are view lines, mapped to cells by the extension.
- The coach sees the editor through `services/editor-context.ts`, added to the newest learner message on each request and **never stored**. Same rules as the tools: project files only, no secret files, secrets redacted.
- `show_step` takes `at` (file, line). The editor puts a label above that line (a CodeLens: "◆ step title · See the official line (Method)"); nothing is drawn in their text (no tint, no faded pseudocode: the user removed both, 2026-11-10). The official line is for the pseudocode line they are on (`ghost.js` counts typed lines; the pseudocode itself is never shown). Clicking it asks the app (`official` message), which fetches the example from the official-docs allowlist (`engines/map/doc-examples.ts`, `editorExample`) and the editor opens it in a read-only peek under the line with the method's line lit. It never comes from the model, and the model never sees it.
- Tasks (no progress bar): a session's tasks, added by the learner or the coach (`set_task`), kept in `<sessionId>.tasks` beside the session. A task can have **steps** (the coach's plan, `set_task` steps, 2-6): each step is a `show_step` with `task_id`, `step_number` and checks; its passing Check marks that step passed, all steps passed make the task done, and the task shows steps passed. A task without steps has "done when" (inputs, in words) and the coach's answer, sealed: never shown to the learner or put back in front of the coach until it matched. A learner's own task waits until the coach writes its check (the `task` intent). Check my answer compares their last ▶ Run with the answer in `core/task-check.ts` (numbers by value, text ignoring case and spacing), never the model. The coach sees the tasks on the newest message only (`forCoach`, never stored). Tasks is a coach mode (locked in ideas). The only progress bars are task progress: tasks done (Tasks mode), and a task's steps passed ("n/m" per task, and the bar on a step card of that task, as in the approved mock); never how the learner is doing; notifications show over the top of the chat (View opens Tasks mode). "Ask about this" puts the task on the composer as a chip, and their own words go to the coach as "About my task “…”: …". Send copies tasks, fresh, into a new or existing session of the same project. A session from before Tasks (no `.tasks` file) brings its old `track_progress` list over once, as the coach's tasks waiting for checks; with no tasks the coach is reminded to add them.
- Feeling comes from editor activity only (`core/feeling.ts`), never from what the learner types, and is never shown as a word or bar (removed 2026-11-13). Stuck shows "Get a hint" and a typed-out step shows "Next step" (`CoachActions`, Chat mode); both send existing intents.

## ▶ Run notes

- Pressed in VS Code (title-bar ▶, ⌘Enter): the app runs the file in its own pty (`services/terminals.ts`) and streams it into VS Code's "▶ Run" terminal (`ipc/editor-runs.ts`), which takes the learner's keystrokes, so `input()` works. Notebooks use VS Code's own Run All.
- Commands per language: `core/runners.ts` (Python with the project's venv; Node, incl. TypeScript on Node 22+; C# via the nearest `.csproj`, or .NET 10 for one file; Java; Kotlin; Swift, or `swift run` for a package; C/C++ with clang). Builds go to a temp folder (`--artifacts-path`, `--scratch-path`, `-o`), never into the project. A missing tool gives its official install page.
- Output, the plain-words line (`core/error-words.ts`) and underlines (`core/run-errors.ts`) come from the run, never the model. The coach sees only the last run (`core/run-view.ts`, newest message, never stored).
- node-pty is N-API (works under Node and Electron with no rebuild); `scripts/fix-node-pty.mjs` makes its `spawn-helper` executable after install.

## Whiteboard notes

- Visualize mode is the whiteboard: every board the coach drew in the session (pan and zoom), filling the pane; with none, "Ask the coach to draw it" (the `visualize` intent). Chat cards show the same board smaller (its canvas not interactive) with Expand, which opens it in Visualize mode (`BoardOpenContext`).
- The Visualize button, and any message sent from Visualize mode (`isDrawing`), restrict the coach to reading, `ask_question` and `draw_board` (`beforeTool`); a reply in words is nudged once to draw (`VISUALIZE_NUDGE`).
- Excalidraw runs in its light theme on the app's ground colour, in the app theme's colours (`BOARD_THEMES`; its own dark theme inverts canvas colours); its menus are hidden (`.bc-board` in globals.css). The camera frames the board's last step with Excalidraw's `scrollToContent` (never past 1.2×), put back after every step, so it never moves while playing; new things fade in. The coach is told to use the real inputs and values from their last run.
