"""
Put the repo root and ``app/`` on ``sys.path``.

The Streamlit app imports ``pyhpo`` from the sibling ``pyhpo/`` package directory
without requiring ``pip install -e .`` (which can fail in minimal venvs that
omit the ``pip`` module).
"""

from __future__ import annotations

import sys
from pathlib import Path

_APP_ROOT = Path(__file__).resolve().parent
_REPO_ROOT = _APP_ROOT.parent

for _p in (_REPO_ROOT, _APP_ROOT):
    s = str(_p)
    if s not in sys.path:
        sys.path.insert(0, s)
