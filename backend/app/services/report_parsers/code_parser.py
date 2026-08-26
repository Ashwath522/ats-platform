"""
parsers/code_parser.py
──────────────────────
Source-code files (.ino / .py / .cpp / .c / .h). Reads the file as text
and surfaces the most informative lines: comments, imports/includes and
function / class declarations — plus the full body as context.
"""

import os
import re


def parse_code(file_path: str) -> tuple[str, str]:
    """Return (text, method) for a source-code file."""
    # Read with encoding fallback.
    content = None
    for enc in ("utf-8", "latin-1", "cp1252"):
        try:
            with open(file_path, "r", encoding=enc) as fh:
                content = fh.read()
            break
        except (UnicodeDecodeError, Exception):
            continue
    if content is None:
        return (f"Could not read code file: {os.path.basename(file_path)}", "code_error")

    comments: list[str] = []
    imports: list[str] = []
    signatures: list[str] = []

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        # Comments (// # /* */ <!-- ).
        if line.startswith(("//", "#", "/*", "*", "<!--")):
            comments.append(line)

        # Imports / includes / libraries.
        if re.match(r"^(import |from |#include|using |require\()", line):
            imports.append(line)

        # Function / class / def signatures.
        if re.match(r"^(def |class |void |int |float |double |public |private |function )", line):
            signatures.append(line)

    summary_parts = [f"Source file: {os.path.basename(file_path)}"]
    if imports:
        summary_parts.append("Imports/Libraries:\n" + "\n".join(imports[:40]))
    if signatures:
        summary_parts.append("Functions/Classes:\n" + "\n".join(signatures[:40]))
    if comments:
        summary_parts.append("Comments:\n" + "\n".join(comments[:60]))

    # Include a trimmed copy of the full body for extra context.
    summary_parts.append("Full code:\n" + content[:4000])

    return ("\n\n".join(summary_parts), "code_text")
