"""Reports and notes: PDF (pdfplumber), DOCX, Markdown/text."""
from __future__ import annotations

import io
import re

from .base import Extracted, clip

METRIC_RE = re.compile(
    r"\b(accuracy|precision|recall|f1(?:[- ]score)?|auc|roc[- ]auc|rmse|mae|mse|r2|r²|iou|map|bleu|efficiency|error)\b"
    r"[^0-9%\n]{0,25}(\d{1,3}(?:\.\d+)?)\s*(%?)", re.I)


METRIC_AFTER_RE = re.compile(
    r"(\d{1,3}(?:\.\d+)?)\s*%\s*(?:test\s+|validation\s+|overall\s+|top-1\s+)?"
    r"(accuracy|precision|recall|f1(?:[- ]score)?|auc|iou|map|efficiency|error)\b", re.I)


def _norm_metric(name: str) -> str:
    n = name.lower().replace(" ", "-").replace("²", "2")
    return "f1" if n.startswith("f1") else n


def metrics_in(text: str, limit: int = 20):
    """Percent-style metrics in text: 'accuracy: 0.91', 'Accuracy 91%', '91% accuracy' → value in %."""
    out, spans = [], []
    for m in METRIC_RE.finditer(text or ""):
        val = float(m.group(2))
        if m.group(3) == "%" or val > 1.0:
            pct = val if val <= 100 else None
        else:
            pct = val * 100
        if pct is not None:
            out.append({"metric": _norm_metric(m.group(1)), "value": round(pct, 2), "raw": m.group(0)[:60]})
            spans.append(m.span())
    for m in METRIC_AFTER_RE.finditer(text or ""):
        if any(a <= m.start() < b or a < m.end() <= b for a, b in spans):
            continue
        val = float(m.group(1))
        if val <= 100:
            out.append({"metric": _norm_metric(m.group(2)), "value": round(val, 2), "raw": m.group(0)[:60]})
    return out[:limit]


def _headings(lines):
    heads = []
    for ln in lines:
        s = ln.strip()
        if 3 <= len(s) <= 70 and (re.match(r"^(\d+(\.\d+)*\.?\s+)?[A-Z][A-Za-z0-9 ,&/()-]+$", s) and (s.isupper() or re.match(r"^\d+(\.\d+)*\.?\s", s))):
            heads.append(s)
    return list(dict.fromkeys(heads))[:25]


def _finish(ex: Extracted, name: str, text: str, pages: int | None):
    words = len(text.split())
    lines = text.splitlines()
    heads = _headings(lines)
    ex.add(f"{name}: {f'{pages} pages, ' if pages else ''}{words} words", locator={"file": name}, key="size")
    if heads:
        ex.add(f"{name} sections: {clip(heads, 12)}", locator={"file": name}, key="headings")
    mets = metrics_in(text)
    for m in mets[:8]:
        ex.add(f"{name} reports {m['raw'].strip()}", locator={"file": name}, confidence="medium", key=f"metric:{m['metric']}")
    ex.text = text[:20000]
    ex.data.update({"file": name, "pages": pages, "words": words, "headings": heads, "metrics": mets})


def parse_pdf(name: str, data: bytes) -> Extracted:
    ex = Extracted(kind="pdf", data={"type": "document"})
    try:
        import pdfplumber
        texts, scanned = [], []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            pages = len(pdf.pages)
            for i, page in enumerate(pdf.pages[:60], 1):
                t = page.extract_text() or ""
                if len(t.strip()) < 15:
                    scanned.append(i)
                texts.append(t)
        if scanned:
            ex.warnings.append(f"{name}: page(s) {clip(scanned, 10)} look scanned — their text was not read.")
        _finish(ex, name, "\n".join(texts), pages)
    except Exception as exc:
        ex.warnings.append(f"{name}: the PDF could not be read ({type(exc).__name__}).")
    return ex


def parse_docx(name: str, data: bytes) -> Extracted:
    ex = Extracted(kind="docx", data={"type": "document"})
    try:
        import docx
        d = docx.Document(io.BytesIO(data))
        paras = [p.text for p in d.paragraphs if p.text.strip()]
        heads = [p.text.strip() for p in d.paragraphs if p.style is not None and p.style.name.lower().startswith("heading") and p.text.strip()]
        _finish(ex, name, "\n".join(paras), None)
        if heads:
            ex.data["headings"] = heads[:25]
        ex.data["tables"] = len(d.tables)
    except Exception as exc:
        ex.warnings.append(f"{name}: the Word file could not be read ({type(exc).__name__}).")
    return ex


def parse_text(name: str, text: str) -> Extracted:
    ex = Extracted(kind="text", data={"type": "document"})
    _finish(ex, name, text, None)
    md_heads = re.findall(r"^#{1,3}\s+(.+)$", text, re.M)
    if md_heads:
        ex.data["headings"] = md_heads[:25]
    return ex
