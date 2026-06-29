#!/bin/sh
# Wait for MongoDB, seed demo data (idempotent), then start the API.
set -e

echo "[entrypoint] waiting for MongoDB at $MONGO_URL ..."
python - <<'PY'
import os, time
from pymongo import MongoClient
url = os.environ["MONGO_URL"]
for i in range(30):
    try:
        MongoClient(url, serverSelectionTimeoutMS=2000).admin.command("ping")
        print("[entrypoint] mongo is up")
        break
    except Exception as e:
        print(f"[entrypoint] mongo not ready ({i}): {e}")
        time.sleep(2)
else:
    print("[entrypoint] mongo never came up — starting anyway")
PY

# Idempotent (seed markers): real demo data on first boot, no-op after.
echo "[entrypoint] seeding demo data ..."
python seed.py || echo "[entrypoint] seed.py skipped/failed"
python seed_diy.py --apply || echo "[entrypoint] seed_diy.py skipped/failed"

echo "[entrypoint] starting uvicorn"
exec uvicorn server:app --host 0.0.0.0 --port 8001
