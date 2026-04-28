# PyHPO Streamlit UI (basic app)

Single-file app under `app/main.py`: **Overview** (counts), **Find a term** (substring search or exact lookup), **Path** (shortest path between two terms).

## Run

From the **repository root** (so `pyhpo/` and `app/` are next to each other):

```bash
pip install -r requirements-ui.txt
streamlit run app/main.py
```

The app adds the repo root to `sys.path`, so you do **not** need `pip install -e .` for the UI. If you still want an editable install for other work, fix a broken venv first (`python -m ensurepip` or recreate the venv), then `pip install -e .`.

First startup loads bundled data from `pyhpo/data/` and may take tens of seconds.

## Documentation and PDF

- **User guide (Markdown):** [documentation/PyHPO_Streamlit_User_Guide.md](documentation/PyHPO_Streamlit_User_Guide.md)
- **PDF:** [documentation/PyHPO_Streamlit_User_Guide.pdf](documentation/PyHPO_Streamlit_User_Guide.pdf) — regenerate with `python scripts/generate_user_guide_pdf.py` (see [documentation/README.md](documentation/README.md)).
