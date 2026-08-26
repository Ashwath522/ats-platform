"""
parsers package
────────────────
File parsers that turn an uploaded project file into plain text plus an
`extraction_method` label. Every parser returns a tuple:

    (extracted_text: str, extraction_method: str)

and NEVER raises — on any failure it returns a short descriptive string
so the pipeline can keep going.
"""

from app.services.report_parsers.router import route_file

__all__ = ["route_file"]
