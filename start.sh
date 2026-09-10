#!/usr/bin/env bash
# Start backend (FastAPI :8000) and frontend (Vite :5273) together.
# Ctrl-C stops both.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# --- data check ---------------------------------------------------------
if [ ! -f "$ROOT/data/GDSC2_fitted_dose_response_27Oct23.xlsx" ]; then
  echo "!! Missing GDSC data files. See data/README.md to download them." >&2
  exit 1
fi

# --- backend ----------------------------------------------------------
cd "$ROOT/backend"
if [ ! -d .venv ]; then
  echo ">> creating backend venv + installing deps"
  python3 -m venv --system-site-packages .venv
  ./.venv/bin/pip install -q -r requirements.txt
fi
./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 &
BACK=$!

# --- frontend -------------------------------------------------------
cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  echo ">> installing frontend deps"
  npm install --no-audit --no-fund
fi
npm run dev &
FRONT=$!

trap 'kill $BACK $FRONT 2>/dev/null' INT TERM
echo ""
echo "  backend : http://127.0.0.1:8000   (API docs at /docs)"
echo "  frontend: http://127.0.0.1:5273"
echo ""
wait
