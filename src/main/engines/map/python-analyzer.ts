/**
 * Reads Python with Python's own parser (ast). It never imports or runs the
 * learner's code. Input on stdin: [{ path, source, cells? }]; output: one record per file.
 */
export const PYTHON_ANALYZER = String.raw`
import ast, json, sys

files = json.loads(sys.stdin.read())

def name_of(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = name_of(node.value)
        return base + "." + node.attr if base else node.attr
    if isinstance(node, ast.Subscript):
        return name_of(node.value)
    if isinstance(node, ast.Call):
        return name_of(node.func)
    return ""

def args_of(fn):
    a = fn.args
    names = [x.arg for x in a.posonlyargs + a.args]
    if a.vararg: names.append("*" + a.vararg.arg)
    names += [x.arg for x in a.kwonlyargs]
    if a.kwarg: names.append("**" + a.kwarg.arg)
    return "(" + ", ".join(names) + ")"

def is_stub(fn, source_lines):
    body = list(fn.body)
    if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) and isinstance(body[0].value.value, str):
        body = body[1:]  # docstring
    if not body:
        return True
    for st in body:
        if isinstance(st, ast.Pass):
            continue
        if isinstance(st, ast.Expr) and isinstance(st.value, ast.Constant) and st.value.value is Ellipsis:
            continue
        if isinstance(st, ast.Raise) and "NotImplementedError" in name_of(st.exc or ast.Constant(None)):
            continue
        return False
    return True

def decorators(fn):
    return [name_of(d) for d in fn.decorator_list]

def referenced(node):
    # Each name used, with the first line it appears on; "mod.Name" keeps its qualifier.
    out, seen = [], set()
    for n in ast.walk(node):
        if isinstance(n, ast.Name):
            key = ("", n.id)
            if key not in seen:
                seen.add(key); out.append({"name": n.id, "line": n.lineno})
        elif isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name):
            key = (n.value.id, n.attr)
            if key not in seen:
                seen.add(key); out.append({"name": n.attr, "qualifier": n.value.id, "line": n.lineno})
    return out

def base_ref(b):
    if isinstance(b, ast.Name):
        return {"name": b.id, "line": b.lineno}
    if isinstance(b, ast.Attribute) and isinstance(b.value, ast.Name):
        return {"name": b.attr, "qualifier": b.value.id, "line": b.lineno}
    if isinstance(b, ast.Subscript):
        return base_ref(b.value)
    return None

def visibility(name):
    if name.startswith("__") and name.endswith("__"):
        return "public"
    return "private" if name.startswith("_") else "public"

def analyze(tree, lines):
    classes, functions, imports = [], [], []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                imports.append({"local": a.asname or a.name.split(".")[0], "module": a.name if a.asname else a.name.split(".")[0],
                                "imported": "*", "level": 0, "line": node.lineno})
        elif isinstance(node, ast.ImportFrom):
            for a in node.names:
                imports.append({"local": a.asname or a.name, "module": node.module or "", "imported": a.name,
                                "level": node.level, "line": node.lineno})
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append({"name": node.name, "args": args_of(node), "line": node.lineno,
                              "stub": is_stub(node, lines), "refs": referenced(node)})
        elif isinstance(node, ast.ClassDef):
            bases = [name_of(b) for b in node.bases if name_of(b)]
            base_refs = [r for r in (base_ref(b) for b in node.bases) if r]
            methods, fields, seen = [], [], set()
            abstract = any(b.split(".")[-1] in ("ABC", "ABCMeta") for b in bases)
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    decs = decorators(item)
                    if any(d.endswith("abstractmethod") for d in decs): abstract = True
                    methods.append({"name": item.name, "args": args_of(item), "line": item.lineno,
                                    "stub": is_stub(item, lines), "static": any(d in ("staticmethod", "classmethod") for d in decs),
                                    "visibility": visibility(item.name)})
                    for sub in ast.walk(item):
                        targets = sub.targets if isinstance(sub, ast.Assign) else [sub.target] if isinstance(sub, (ast.AnnAssign, ast.AugAssign)) else []
                        for t in targets:
                            if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == "self" and t.attr not in seen:
                                seen.add(t.attr)
                                fields.append({"name": t.attr, "line": t.lineno, "visibility": visibility(t.attr)})
                elif isinstance(item, (ast.Assign, ast.AnnAssign)):
                    targets = item.targets if isinstance(item, ast.Assign) else [item.target]
                    for t in targets:
                        if isinstance(t, ast.Name) and t.id not in seen:
                            seen.add(t.id)
                            fields.append({"name": t.id, "line": t.lineno, "visibility": visibility(t.id), "static": True})
            kind = "class"
            last = [b.split(".")[-1] for b in bases]
            if any(b in ("Enum", "IntEnum", "StrEnum", "Flag") for b in last): kind = "enum"
            elif "Protocol" in last: kind = "interface"
            elif abstract: kind = "abstract"
            classes.append({"name": node.name, "line": node.lineno, "bases": bases, "baseRefs": base_refs, "kind": kind,
                            "methods": methods, "fields": fields, "refs": referenced(node)})
    return classes, functions, imports

results = []
for f in files:
    source = f["source"]
    lines = source.split("\n")
    chunks = [(c["start"], c["end"]) for c in f["cells"]] if f.get("cells") else [(1, len(lines))]
    rec = {"path": f["path"], "classes": [], "functions": [], "imports": [], "errors": []}
    imports = []
    for start, end in chunks:
        text = "\n" * (start - 1) + "\n".join(lines[start - 1:end])
        try:
            tree = ast.parse(text)
        except SyntaxError as e:
            rec["errors"].append("line %s: %s" % (e.lineno, e.msg))
            continue
        c, fn, im = analyze(tree, lines)
        rec["classes"] += c
        rec["functions"] += fn
        imports += im
    rec["imports"] = imports
    results.append(rec)

sys.stdout.write(json.dumps(results))
`
