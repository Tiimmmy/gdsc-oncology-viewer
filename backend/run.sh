#!/usr/bin/env bash
# Start the FastAPI backend (http://127.0.0.1:8000, docs at /docs)
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv --system-site-packages .venv
  ./.venv/bin/pip install -r requirements.txt
fi
exec ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 "$@"
