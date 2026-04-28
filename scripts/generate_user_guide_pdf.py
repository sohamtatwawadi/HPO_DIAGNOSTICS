#!/usr/bin/env python3
"""
Build documentation/PyHPO_Streamlit_User_Guide.pdf from the Markdown source.

Usage (from repository root)::

    pip install -r documentation/requirements-pdf.txt
    python scripts/generate_user_guide_pdf.py

Optional::

    python scripts/generate_user_guide_pdf.py --md path/to/guide.md --out path/to/out.pdf
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from reportlab.platypus.flowables import Preformatted


def _para(text: str, style: ParagraphStyle) -> Paragraph:
    """Escape text for ReportLab Paragraph (subset of HTML)."""
    safe = escape(text).replace("\n", "<br/>")
    return Paragraph(safe, style)


def md_to_story(md_path: Path, styles) -> list:
    """Minimal Markdown → ReportLab flowables (#/##/###, bullets, paragraphs, code fences)."""
    lines = md_path.read_text(encoding="utf-8").splitlines()
    story: list = []
    in_code = False
    code_buf: list[str] = []

    def flush_code():
        nonlocal code_buf
        if code_buf:
            body = "\n".join(code_buf)
            story.append(
                Preformatted(
                    body,
                    styles["Code"],
                    maxLineLength=96,
                    splitChars=" /",
                )
            )
            story.append(Spacer(1, 0.12 * inch))
        code_buf = []

    for raw in lines:
        line = raw.rstrip("\n")
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_code:
                flush_code()
                in_code = False
            else:
                flush_code()
                in_code = True
            continue

        if in_code:
            code_buf.append(line)
            continue

        if not stripped:
            story.append(Spacer(1, 0.08 * inch))
            continue

        if stripped == "---" or set(stripped) == {"-"}:
            story.append(Spacer(1, 0.12 * inch))
            continue

        if stripped.startswith("### "):
            story.append(_para(stripped[4:], styles["H3"]))
            story.append(Spacer(1, 0.06 * inch))
            continue
        if stripped.startswith("## "):
            story.append(_para(stripped[3:], styles["H2"]))
            story.append(Spacer(1, 0.08 * inch))
            continue
        if stripped.startswith("# "):
            story.append(_para(stripped[2:], styles["H1"]))
            story.append(Spacer(1, 0.1 * inch))
            continue

        if stripped.startswith("- "):
            btxt = stripped[2:]
            btxt = re.sub(r"\*\*(.+?)\*\*", r"\1", btxt)
            story.append(_para(f"• {btxt}", styles["Bullet"]))
            story.append(Spacer(1, 0.04 * inch))
            continue

        # Strip simple **bold** for PDF (keep inner text)
        txt = stripped
        txt = re.sub(r"\*\*(.+?)\*\*", r"\1", txt)
        story.append(_para(txt, styles["Body"]))
        story.append(Spacer(1, 0.06 * inch))

    flush_code()
    return story


def build_styles():
    base = getSampleStyleSheet()
    body = ParagraphStyle(
        "Body",
        parent=base["Normal"],
        fontName="Helvetica",
        fontSize=10,
        leading=14,
        spaceAfter=6,
    )
    h1 = ParagraphStyle(
        "H1",
        parent=base["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=10,
    )
    h2 = ParagraphStyle(
        "H2",
        parent=base["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        textColor=colors.HexColor("#1e293b"),
        spaceAfter=8,
    )
    h3 = ParagraphStyle(
        "H3",
        parent=base["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        textColor=colors.HexColor("#334155"),
        spaceAfter=6,
    )
    bullet = ParagraphStyle(
        "Bullet",
        parent=body,
        leftIndent=14,
        bulletIndent=6,
    )
    code = ParagraphStyle(
        "Code",
        parent=base["Code"],
        fontName="Courier",
        fontSize=8,
        leading=10,
        backColor=colors.HexColor("#f1f5f9"),
        borderPadding=6,
    )
    return {"Body": body, "H1": h1, "H2": h2, "H3": h3, "Bullet": bullet, "Code": code}


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    default_md = root / "documentation" / "PyHPO_Streamlit_User_Guide.md"
    default_out = root / "documentation" / "PyHPO_Streamlit_User_Guide.pdf"

    ap = argparse.ArgumentParser(description="Generate PyHPO Streamlit user guide PDF.")
    ap.add_argument("--md", type=Path, default=default_md, help="Input Markdown path")
    ap.add_argument("--out", type=Path, default=default_out, help="Output PDF path")
    args = ap.parse_args()

    if not args.md.is_file():
        raise SystemExit(f"Missing Markdown file: {args.md}")

    styles = build_styles()
    story = md_to_story(args.md, styles)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(args.out),
        pagesize=LETTER,
        rightMargin=0.75 * inch,
        leftMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
        title="PyHPO Streamlit User Guide",
        author="pyhpo repository documentation",
    )
    doc.build(story)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
