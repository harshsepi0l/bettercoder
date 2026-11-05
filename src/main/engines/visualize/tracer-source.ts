/**
 * The Python tracer, run in a sandboxed child process on a temporary copy of
 * the project. It imports the learner's module, runs a validated scenario,
 * and records each line with the variables in scope. Reads one JSON request
 * on stdin; writes one JSON result on stdout.
 */
export const TRACER_SOURCE = String.raw`
import io, json, os, sys, importlib.util

MAX_STEPS = 400
MAX_ITEMS = 12
MAX_DEPTH = 3
MAX_STR = 120

req = json.loads(sys.stdin.read())
# No calls given: run the whole file (or notebook) top to bottom and trace it.
SCRIPT = len(req.get("scenario", [])) == 0
root = os.path.realpath(req["root"])
module_file = os.path.realpath(os.path.join(root, req["module"]))
# The file's folder and every folder above it up to the project root, nearest first, so
# "from app.x import y" works from backend/app/... the way it does when run from backend/.
_dirs, _d = [], os.path.dirname(module_file)
while True:
    _dirs.append(_d)
    if _d == root or not _d.startswith(root + os.sep):
        break
    _d = os.path.dirname(_d)
sys.path[0:0] = _dirs

# The module's real dotted name when it sits inside packages, so relative imports work.
_parts, _d = [os.path.splitext(os.path.basename(module_file))[0]], os.path.dirname(module_file)
while _d.startswith(root + os.sep) and os.path.exists(os.path.join(_d, "__init__.py")):
    _parts.insert(0, os.path.basename(_d))
    _d = os.path.dirname(_d)
MODULE_NAME = ".".join(_parts) if len(_parts) > 1 else "learner_module"

# A replay cannot type at the keyboard: stop cleanly at input() instead of failing with EOFError.
class NeedsInput(BaseException):
    pass
def _no_input(prompt=""):
    raise NeedsInput("Stopped at input(): the program waits for typing here. Animate one of its functions with example values instead.")
import builtins as _b
_b.input = _no_input

# Notebook-only helpers, so display()/YouTubeVideo cells don't stop a run outside Jupyter.
import builtins, types
if not hasattr(builtins, "display"):
    builtins.display = lambda *a, **k: None
try:
    import IPython.display  # noqa: F401
except Exception:
    ipy = types.ModuleType("IPython"); disp = types.ModuleType("IPython.display")
    class _Shown:
        def __init__(self, *a, **k): pass
    for _n in ("YouTubeVideo", "HTML", "Image", "Markdown", "Video", "IFrame", "Math", "Latex"):
        setattr(disp, _n, _Shown)
    disp.display = lambda *a, **k: None
    disp.clear_output = lambda *a, **k: None
    ipy.display = disp
    sys.modules["IPython"] = ipy; sys.modules["IPython.display"] = disp

# Replays don't need real time: skip sleeps and plot pauses (an animation loop would otherwise wait).
import time
time.sleep = lambda *a, **k: None
if req.get("usesMatplotlib"):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as _plt
        _plt.pause = lambda *a, **k: None
        _plt.show = lambda *a, **k: None
    except Exception:
        pass

TIME_LIMIT = float(req.get("timeLimit") or 6.0)
started = time.monotonic()

steps = []
out = io.StringIO()
real_stdout = sys.stdout
scenario_ns = {}
current = {"step": 0}
stopped = {"why": None}

class StepLimit(Exception):
    pass

def value(v, depth=0):
    # NumPy arrays: small ones become nested lists (drawn as a grid), labelled with their shape.
    if type(v).__name__ == "ndarray" and hasattr(v, "tolist") and hasattr(v, "shape"):
        try:
            if v.size <= 400:
                res = value(v.tolist(), depth)
                if res.get("t") == "list":
                    res["label"] = "array " + "×".join(str(d) for d in v.shape)
                return res
            return {"t": "repr", "v": "array %s of %d numbers" % ("×".join(str(d) for d in v.shape), v.size)}
        except Exception:
            pass
    if v is None:
        return {"t": "none"}
    if isinstance(v, bool):
        return {"t": "bool", "v": v}
    if isinstance(v, (int, float)):
        return {"t": "num", "v": v if abs(v) < 1e15 else repr(v)}
    if isinstance(v, str):
        return {"t": "str", "v": v if len(v) <= MAX_STR else v[:MAX_STR] + "…"}
    if depth >= MAX_DEPTH:
        return {"t": "repr", "v": type(v).__name__ + "…"}
    if isinstance(v, (list, tuple, set, frozenset)):
        kind = "list" if isinstance(v, list) else "tuple" if isinstance(v, tuple) else "set"
        items = list(v)
        res = {"t": "list", "kind": kind, "id": str(id(v)), "items": [value(x, depth + 1) for x in items[:MAX_ITEMS]]}
        if len(items) > MAX_ITEMS:
            res["more"] = len(items) - MAX_ITEMS
        return res
    if isinstance(v, dict):
        entries = list(v.items())
        res = {"t": "dict", "id": str(id(v)), "entries": [[value(k, depth + 1), value(x, depth + 1)] for k, x in entries[:MAX_ITEMS]]}
        if len(entries) > MAX_ITEMS:
            res["more"] = len(entries) - MAX_ITEMS
        return res
    if callable(v) and hasattr(v, "__name__"):
        return {"t": "func", "name": getattr(v, "__qualname__", v.__name__)}
    fields = getattr(v, "__dict__", None)
    if isinstance(fields, dict):
        return {"t": "obj", "cls": type(v).__name__, "id": str(id(v)),
                "fields": [[k, value(x, depth + 1)] for k, x in list(fields.items())[:MAX_ITEMS] if not k.startswith("__")]}
    try:
        r = repr(v)
    except Exception:
        r = "<" + type(v).__name__ + ">"
    return {"t": "repr", "v": r[:MAX_STR]}

_user_files = {}
def is_user(code):
    # Called for every function call, including inside big libraries (torch), so the answer
    # is cached per file: a realpath on each call made heavy imports 10x slower.
    name = code.co_filename
    known = _user_files.get(name)
    if known is None:
        # Built-in and frozen code (like "<frozen importlib._bootstrap>") is never the learner's.
        known = bool(name) and not name.startswith("<") and os.path.isabs(name) and os.path.realpath(name).startswith(root + os.sep)
        _user_files[name] = known
    return known

def locals_of(frame):
    out_vars = []
    top = frame.f_code.co_name == "<module>"
    for k, v in frame.f_locals.items():
        if k.startswith("__"):
            continue
        if type(v).__name__ == "module":
            continue
        # At the top level of a script/notebook, show data, not the functions and classes it defines.
        if top and (k.startswith("_") or isinstance(v, type) or callable(v)):
            continue
        out_vars.append([k, value(v)])
    return out_vars

def snapshot(frame, event, arg):
    if len(steps) >= MAX_STEPS:
        stopped["why"] = "Stopped after %d steps." % MAX_STEPS
        raise StepLimit()
    if time.monotonic() - started > TIME_LIMIT:
        stopped["why"] = "Stopped after %d seconds of running; this shows the start." % TIME_LIMIT
        raise StepLimit()
    stack = []
    f = frame
    while f is not None:
        if is_user(f.f_code):
            stack.append(f)
        f = f.f_back
    stack.reverse()
    frames = [] if SCRIPT else [{"func": "scenario", "locals": [[k, value(v)] for k, v in scenario_ns.items()]}]
    for f in stack:
        name = "top level" if f.f_code.co_name == "<module>" else f.f_code.co_name
        frames.append({"func": name, "locals": locals_of(f)})
    step = {
        "event": event,
        "file": os.path.relpath(os.path.realpath(frame.f_code.co_filename), root),
        "line": frame.f_lineno,
        "func": "top level" if frame.f_code.co_name == "<module>" else frame.f_code.co_name,
        "frames": frames,
        "output": out.getvalue()[-2000:],
        "scenarioStep": current["step"],
    }
    if event == "return":
        step["returnValue"] = value(arg)
    if event == "exception":
        step["exception"] = "%s: %s" % (arg[0].__name__, arg[1])
    steps.append(step)

def tracer(frame, event, arg):
    if not is_user(frame.f_code):
        return None
    if frame.f_code.co_name == "<module>" and not (SCRIPT and os.path.realpath(frame.f_code.co_filename) == module_file):
        return None  # importing a file is setup, not part of the story (unless we run the file itself)
    # The top level of a file has no meaningful call/return; its lines and errors are the story.
    if frame.f_code.co_name == "<module>" and event in ("call", "return"):
        return tracer
    if event in ("call", "line", "return", "exception"):
        snapshot(frame, event, arg)
    return tracer

result = {"steps": steps}
try:
    spec = importlib.util.spec_from_file_location(MODULE_NAME, module_file)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[MODULE_NAME] = mod
    sys.stdout = out
    if SCRIPT:
        cells = req.get("cells")
        if cells:
            # A notebook: run cell by cell, like Jupyter. A cell that does not even parse
            # (often unfinished work) is reported and skipped; a runtime error stops the run.
            with open(module_file, encoding="utf-8") as fh:
                lines = fh.read().split("\n")
            mod.__dict__["__name__"] = "__main__"
            mod.__dict__["__file__"] = module_file
            for cell in cells:
                src = "\n" * (cell["start"] - 1) + "\n".join(lines[cell["start"] - 1:cell["end"]])
                try:
                    code = compile(src, module_file, "exec")
                except SyntaxError as e:
                    steps.append({"event": "exception", "file": os.path.relpath(module_file, root),
                                  "line": e.lineno or cell["start"], "func": "top level",
                                  "frames": [{"func": "top level", "locals": [[k, value(v)] for k, v in vars(mod).items()
                                      if not k.startswith("_") and type(v).__name__ != "module" and not isinstance(v, type) and not callable(v)]}],
                                  "output": out.getvalue()[-2000:], "scenarioStep": 0,
                                  "exception": "SyntaxError: %s (this cell was skipped)" % e.msg})
                    continue
                sys.settrace(tracer)
                try:
                    exec(code, mod.__dict__)
                finally:
                    sys.settrace(None)
            sys.stdout = real_stdout
        else:
            # Run as the program itself, so its "if __name__ == '__main__':" block runs too.
            with open(module_file, encoding="utf-8") as fh:
                code = compile(fh.read(), module_file, "exec")
            mod.__dict__["__name__"] = "__main__"
            sys.settrace(tracer)
            try:
                exec(code, mod.__dict__)
            finally:
                sys.settrace(None)
                sys.stdout = real_stdout
        # A closing step: the file has finished, with its final variables and everything printed.
        if steps and len(steps) < MAX_STEPS:
            last = steps[-1]
            top = [[k, value(v)] for k, v in vars(mod).items()
                   if not k.startswith("_") and type(v).__name__ != "module" and not isinstance(v, type) and not callable(v)]
            steps.append({"event": "return", "file": last["file"], "line": last["line"], "func": "top level",
                          "frames": [{"func": "top level", "locals": top}], "output": out.getvalue()[-2000:],
                          "scenarioStep": 0})
        raise SystemExit(0)
    spec.loader.exec_module(mod)
    sys.stdout = real_stdout

    def resolve(name):
        parts = name.split(".")
        if parts[0] in scenario_ns:
            obj = scenario_ns[parts[0]]
        elif hasattr(mod, parts[0]):
            obj = getattr(mod, parts[0])
        else:
            raise NameError("'%s' is not defined in %s" % (parts[0], req["module"]))
        for p in parts[1:]:
            obj = getattr(obj, p)
        return obj

    sys.settrace(tracer)
    sys.stdout = out
    try:
        for i, call in enumerate(req["scenario"]):
            current["step"] = i
            fn = resolve(call["call"])
            res = fn(*call.get("args", []))
            if call.get("assign"):
                scenario_ns[call["assign"]] = res
    finally:
        sys.settrace(None)
        sys.stdout = real_stdout
except (StepLimit, SystemExit):
    pass
except NeedsInput as e:
    sys.settrace(None)
    sys.stdout = real_stdout
    stopped["why"] = str(e)
except Exception as e:
    sys.settrace(None)
    sys.stdout = real_stdout
    if not steps or "exception" not in steps[-1]:
        stopped["why"] = "%s: %s" % (type(e).__name__, e)
    else:
        stopped["why"] = steps[-1]["exception"]

if stopped["why"]:
    result["stopped"] = stopped["why"]
result["output"] = out.getvalue()[-2000:]
real_stdout.write(json.dumps(result))
`
