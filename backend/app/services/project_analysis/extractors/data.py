"""Notebooks and datasets: what was trained, what was measured, and data quality."""
from __future__ import annotations

import csv
import io
import json
import re
from collections import Counter

from .base import Extracted, clip
from .documents import metrics_in

ML_LIBS = {"sklearn", "tensorflow", "keras", "torch", "xgboost", "lightgbm", "catboost", "transformers", "pandas", "numpy",
           "cv2", "ultralytics", "statsmodels", "prophet"}
MODEL_RE = re.compile(r"\b([A-Z][A-Za-z]*(?:Regressor|Classifier|Regression|Forest|Boost\w*|SVC|SVR|KMeans|Net|LSTM|GRU|Transformer|YOLO\w*|CNN|Sequential))\s*\(")


def parse_ipynb(name: str, text: str) -> Extracted:
    ex = Extracted(kind="ipynb")
    try:
        nb = json.loads(text)
    except Exception:
        ex.warnings.append(f"{name}: not a valid notebook.")
        return ex
    cells = nb.get("cells", [])
    code_cells = [c for c in cells if c.get("cell_type") == "code"]
    sources = ["".join(c.get("source", [])) if isinstance(c.get("source"), list) else str(c.get("source", "")) for c in code_cells]
    code = "\n".join(sources)
    imports = sorted({(a or b).split(".")[0] for a, b in re.findall(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))", code, re.M)})
    models = sorted(set(MODEL_RE.findall(code)))
    executed = sum(1 for c in code_cells if c.get("execution_count"))
    metrics = []
    for idx, c in enumerate(code_cells):
        out_text = ""
        for o in c.get("outputs", []) or []:
            t = o.get("text") or (o.get("data") or {}).get("text/plain") or ""
            out_text += ("".join(t) if isinstance(t, list) else str(t)) + "\n"
        for m in metrics_in(out_text, 10):
            m["cell"] = idx + 1
            metrics.append(m)

    # leakage / evaluation heuristics (findings, never accusations)
    findings = []
    split = re.search(r"train_test_split\s*\(", code)
    fit_pos = [m.start() for m in re.finditer(r"\b(?:StandardScaler|MinMaxScaler|RobustScaler|LabelEncoder|OneHotEncoder|PCA|SimpleImputer)\b[^\n]*\n?[^\n]*\.fit(?:_transform)?\s*\(\s*(?:X|df|data)\b", code)]
    if split and fit_pos and min(fit_pos) < split.start():
        findings.append("A scaler/encoder appears to be fitted on the full data before train_test_split (possible data leakage).")
    if not split and not re.search(r"cross_val|KFold|validation_split|validation_data|test_size", code) and models:
        findings.append("No train/test split or cross-validation was found in the notebook code.")
    if re.search(r"\.score\s*\(\s*X_train|accuracy_score\s*\(\s*y_train", code):
        findings.append("A metric is computed on the training data.")
    if models and not re.search(r"random_state|seed\s*\(|manual_seed", code):
        findings.append("No random seed / random_state found — results may not be reproducible.")

    ex.add(f"{name}: {len(cells)} cells ({len(code_cells)} code, {executed} executed)", locator={"file": name}, key="cells")
    if imports:
        ex.add(f"{name} imports: {clip(imports)}", locator={"file": name}, key="imports")
    if models:
        ex.add(f"{name} builds models: {clip(models)}", locator={"file": name}, key="models")
    for m in metrics[:10]:
        ex.add(f"{name} output (cell {m['cell']}) shows {m['raw'].strip()}", locator={"file": name, "cell": m["cell"]}, key=f"metric:{m['metric']}")
    for f in findings:
        ex.add(f"{name}: {f}", locator={"file": name}, method="rule", confidence="medium", key="ml_finding")
    ex.data = {"type": "notebook", "file": name, "imports": imports, "models": models, "metrics": metrics, "findings": findings,
               "executed_cells": executed, "code_cells": len(code_cells)}
    return ex


def parse_csv(name: str, text: str) -> Extracted:
    ex = Extracted(kind="csv")
    sample = text[:5_000_000]
    try:
        dialect = csv.Sniffer().sniff(sample[:4000], delimiters=",;\t|")
    except Exception:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(sample), dialect))
    if not rows:
        ex.warnings.append(f"{name}: empty CSV.")
        return ex
    header, body = rows[0], [r for r in rows[1:] if any(c.strip() for c in r)]
    ncols = len(header)
    missing = sum(1 for r in body for i in range(ncols) if i >= len(r) or not r[i].strip())
    total = max(1, len(body) * ncols)
    dups = len(body) - len({tuple(r) for r in body})
    ex.add(f"{name}: {len(body)} rows × {ncols} columns ({clip(header, 10)})" + (" — first 5 MB read" if len(text) > len(sample) else ""), locator={"file": name}, key="shape")
    ex.add(f"{name}: {missing / total * 100:.1f}% missing values, {dups} duplicate row(s)", locator={"file": name}, key="quality")
    balance = None
    last = header[-1] if header else None
    if body and last:
        vals = Counter(r[-1] for r in body if len(r) == ncols)
        if 1 < len(vals) <= 20:
            top = vals.most_common()
            balance = {k: v for k, v in top}
            ex.add(f"{name}: last column '{last}' has {len(vals)} classes, largest {top[0][1] / len(body) * 100:.0f}% of rows", locator={"file": name}, confidence="medium", key="balance")
    ex.data = {"type": "dataset", "file": name, "rows": len(body), "cols": ncols, "header": header[:50],
               "missing_pct": round(missing / total * 100, 2), "duplicates": dups, "balance": balance}
    return ex
