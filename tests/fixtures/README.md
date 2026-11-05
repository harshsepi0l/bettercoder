# Test fixtures

Small sample projects the tests open read-only. Tests never write to them.

- `todo-app/`: Python to-do list with a planted off-by-one bug in `remove()` and an unwritten `complete()`.
- `notebook/day17.ipynb`: a Jupyter notebook (markdown, code, a text output, an embedded image, an error). Uses NumPy.
- `notebook/forest.ipynb`: a small forest-fire grid in plain Python (a magic line, a function, a top-level loop).
- `notebook/unfinished.ipynb`: a student notebook mid-way: an unfinished `def make_grid(....):` stub, a YouTube cell, `display()`, and `time.sleep(5)` in a loop.
- `java-shapes/`: a small Java hierarchy (interface `Shape`, abstract `AbstractShape`, `Circle`, `Main`) for the class diagram.
- `mixed-app/`: a Python backend and a TypeScript frontend that both define `Patent` (the case that once produced cross-language arrows), with a relative import, an `@/` alias import and a `module.Name` reference.

- `nested-backend/`: Python package under `backend/app` with absolute (`from app.core…`) and relative imports, for the animator's import path.
- `dotnet-calculator/`: a fresh .NET console app (only "Hello, World!"), as in a real session where the coach answered its own questions.
