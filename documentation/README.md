# Documentation

## PyHPO Streamlit UI — user guide

- **Markdown (source):** [PyHPO_Streamlit_User_Guide.md](PyHPO_Streamlit_User_Guide.md) — use cases, architecture, and page-by-page workflows.
- **PDF (generated):** [PyHPO_Streamlit_User_Guide.pdf](PyHPO_Streamlit_User_Guide.pdf) — build with the script below if the PDF is not committed yet.

### Build the PDF

From the repository root:

```bash
pip install -r documentation/requirements-pdf.txt
python scripts/generate_user_guide_pdf.py
```

Optional paths:

```bash
python scripts/generate_user_guide_pdf.py \
  --md documentation/PyHPO_Streamlit_User_Guide.md \
  --out documentation/PyHPO_Streamlit_User_Guide.pdf
```

The generator reads the Markdown file and produces a multi-page PDF using [ReportLab](https://www.reportlab.com/).
