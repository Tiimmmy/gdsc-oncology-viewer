"""In-memory store for user-uploaded datasets.

Security requirement: uploaded Excel/CSV data is **never written to disk** and
**never cached**. It lives only in this process's memory, keyed by an
unguessable session id, and is evicted when:
  * the client calls ``DELETE /api/session/{id}`` (fired on tab close / refresh),
  * the session is idle longer than ``UPLOAD_SESSION_TTL_SECONDS``,
  * the process exits (``purge_all`` on shutdown),
  * the global session cap is exceeded (oldest evicted first).
"""
from __future__ import annotations

import logging
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

import pandas as pd

from .config import UPLOAD_MAX_SESSIONS, UPLOAD_SESSION_TTL_SECONDS

log = logging.getLogger("gdsc.upload")


@dataclass
class Session:
    id: str
    df: pd.DataFrame
    catalogs: dict
    summary: dict
    report: dict
    filename: str
    created: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)

    def touch(self) -> None:
        self.last_seen = time.time()

    @property
    def expired(self) -> bool:
        return (time.time() - self.last_seen) > UPLOAD_SESSION_TTL_SECONDS

    def public(self) -> dict:
        return {
            "session_id": self.id,
            "filename": self.filename,
            "created": self.created,
            "expires_in_seconds": max(
                0, int(UPLOAD_SESSION_TTL_SECONDS - (time.time() - self.last_seen))
            ),
            "summary": self.summary,
            "cleaning_report": self.report,
            "counts": {
                "drugs": len(self.catalogs["drugs"]),
                "targets": len(self.catalogs["targets"]),
                "pathways": len(self.catalogs["pathways"]),
                "tumour_types": len(self.catalogs["tumour_types"]),
            },
        }


_SESSIONS: dict[str, Session] = {}
_LOCK = threading.RLock()


def _sweep_locked() -> None:
    for sid in [s for s, sess in _SESSIONS.items() if sess.expired]:
        _SESSIONS.pop(sid, None)
        log.info("Evicted expired upload session %s", sid[:8])
    while len(_SESSIONS) > UPLOAD_MAX_SESSIONS:
        oldest = min(_SESSIONS.values(), key=lambda s: s.last_seen)
        _SESSIONS.pop(oldest.id, None)
        log.info("Evicted upload session %s (over capacity)", oldest.id[:8])


def create(df: pd.DataFrame, catalogs: dict, summary: dict, report: dict, filename: str) -> Session:
    with _LOCK:
        _sweep_locked()
        sid = secrets.token_urlsafe(24)
        sess = Session(id=sid, df=df, catalogs=catalogs, summary=summary, report=report,
                       filename=filename)
        _SESSIONS[sid] = sess
        log.info("Created upload session %s (%s, %d rows)", sid[:8], filename, len(df))
        return sess


def get(session_id: str) -> Optional[Session]:
    with _LOCK:
        _sweep_locked()
        sess = _SESSIONS.get(session_id)
        if sess is None:
            return None
        sess.touch()
        return sess


def drop(session_id: str) -> bool:
    with _LOCK:
        existed = _SESSIONS.pop(session_id, None) is not None
        if existed:
            log.info("Dropped upload session %s", session_id[:8])
        return existed


def purge_all() -> None:
    with _LOCK:
        n = len(_SESSIONS)
        _SESSIONS.clear()
        if n:
            log.info("Purged all %d upload sessions", n)


def active_count() -> int:
    with _LOCK:
        _sweep_locked()
        return len(_SESSIONS)
