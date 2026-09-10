"""FastAPI application — JSON API for the GDSC drug-sensitivity tool.

Endpoints
---------
GET    /api/health                       liveness + built-in dataset summary
GET    /api/meta?session_id=             catalogs (built-in, or an uploaded session)
GET    /api/drugs?q=&dataset=&session_id= drug autocomplete
POST   /api/analyze                      mean-sensitivity analysis
POST   /api/screen                       threshold screen (drugs/targets/pathways)
POST   /api/upload            (multipart) validate + hold an uploaded file in memory
DELETE /api/session/{id}                 drop an uploaded session (no persistence)
POST   /api/export/tumour-stats.csv
POST   /api/export/comparison.csv
POST   /api/export/screen.csv
"""
from __future__ import annotations

import csv
import io
import logging

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import analysis, data_store, screening, upload_store
from .config import (
    DEFAULT_CONTROL_DRUG,
    DEFAULT_DATASET,
    UPLOAD_MAX_BYTES,
)
from .schemas import AnalyzeRequest, ScreenRequest
from .validation import ValidationError, normalize_and_clean, read_table

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("gdsc.api")

app = FastAPI(
    title="GDSC Drug Anti-cancer Sensitivity API",
    version="2.0.0",
    description="Mean-sensitivity analysis and threshold screening of anti-cancer "
    "drugs across TCGA tumour types. Supports the bundled GDSC data or a "
    "user-uploaded GDSC subset held in memory only.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _no_store(request: Request, call_next):
    """Never let a proxy / browser cache API responses — matters most for any
    response derived from user-uploaded data."""
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response


@app.on_event("startup")
def _startup() -> None:
    data_store.load()
    data_store.catalogs()
    log.info("Built-in data ready: %s", data_store.stats_summary())


@app.on_event("shutdown")
def _shutdown() -> None:
    upload_store.purge_all()


# ---------------------------------------------------------------------------
# exception handlers — always JSON, never a blank 500
# ---------------------------------------------------------------------------
@app.exception_handler(ValidationError)
async def _handle_validation(_: Request, exc: ValidationError):
    return JSONResponse(status_code=422, content={"detail": exc.message, "info": exc.detail})


@app.exception_handler(analysis.AnalysisError)
async def _handle_analysis(_: Request, exc: analysis.AnalysisError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(RequestValidationError)
async def _handle_request_validation(_: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "请求参数不合法。", "errors": exc.errors()})


@app.exception_handler(Exception)
async def _handle_unexpected(request: Request, exc: Exception):
    log.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": f"服务器内部错误：{type(exc).__name__}. 请调整输入后重试。"},
    )


# ---------------------------------------------------------------------------
# frame resolver
# ---------------------------------------------------------------------------
def _resolve(source: str, session_id: str | None):
    """Return (df, catalogs, summary, is_upload)."""
    if (source or "builtin").lower() == "upload":
        if not session_id:
            raise analysis.AnalysisError("缺少上传会话 ID，请重新上传文件。")
        sess = upload_store.get(session_id)
        if sess is None:
            raise analysis.AnalysisError("上传会话已过期或不存在，请重新上传文件。")
        return sess.df, sess.catalogs, sess.summary, True
    return data_store.get_frame(), data_store.catalogs(), data_store.stats_summary(), False


# ---------------------------------------------------------------------------
# meta / catalog endpoints
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "data": data_store.stats_summary(),
        "upload_sessions": upload_store.active_count(),
    }


def _meta_payload(cat: dict, summary: dict, *, is_upload: bool) -> dict:
    return {
        "source": "upload" if is_upload else "builtin",
        "datasets": cat["datasets"],
        "default_dataset": None if is_upload else DEFAULT_DATASET,
        "default_control_drug": DEFAULT_CONTROL_DRUG,
        "counts": {
            "drugs": len(cat["drugs"]),
            "targets": len(cat["targets"]),
            "pathways": len(cat["pathways"]),
            "tumour_types": len(cat["tumour_types"]),
        },
        "drugs": cat["drugs"],
        "targets": cat["targets"],
        "pathways": cat["pathways"],
        "tumour_types": cat["tumour_types"],
        "summary": summary,
    }


@app.get("/api/meta")
def meta(session_id: str | None = Query(None)):
    if session_id:
        sess = upload_store.get(session_id)
        if sess is None:
            raise HTTPException(status_code=404, detail="上传会话已过期或不存在，请重新上传文件。")
        return _meta_payload(sess.catalogs, sess.summary, is_upload=True)
    return _meta_payload(data_store.catalogs(), data_store.stats_summary(), is_upload=False)


@app.get("/api/drugs")
def drugs(
    q: str = Query(""),
    dataset: str | None = Query(None),
    session_id: str | None = Query(None),
    limit: int = Query(30, ge=1, le=200),
):
    if session_id:
        sess = upload_store.get(session_id)
        if sess is None:
            raise HTTPException(status_code=404, detail="上传会话已过期，请重新上传文件。")
        cat = sess.catalogs
    else:
        cat = data_store.catalogs()

    q_low = q.strip().lower()
    rows = cat["drugs"]
    if dataset:
        rows = [r for r in rows if dataset in r["datasets"]]
    if q_low:
        starts = [r for r in rows if r["name"].lower().startswith(q_low)]
        contains = [
            r for r in rows
            if q_low in r["name"].lower() and not r["name"].lower().startswith(q_low)
        ]
        target_hit = [
            r for r in rows
            if q_low not in r["name"].lower() and any(q_low in t.lower() for t in r["targets"])
        ]
        rows = starts + contains + target_hit
    return {"count": len(rows), "results": rows[:limit]}


# ---------------------------------------------------------------------------
# upload / session lifecycle  (in-memory only — never written to disk)
# ---------------------------------------------------------------------------
@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    raw = await file.read()
    if len(raw) > UPLOAD_MAX_BYTES:
        raise ValidationError(
            f"文件过大（{len(raw) / 1e6:.1f} MB），上限为 {UPLOAD_MAX_BYTES / 1e6:.0f} MB。"
        )
    table = read_table(raw, file.filename or "upload")
    df, report = normalize_and_clean(table, default_dataset="UPLOAD", strict=True)
    cat = data_store.build_catalogs(df)
    summary = data_store.summarize(df)
    # release the raw bytes immediately
    del raw, table
    sess = upload_store.create(df, cat, summary, report, file.filename or "upload")
    return {**sess.public(), "meta": _meta_payload(cat, summary, is_upload=True)}


@app.delete("/api/session/{session_id}")
def drop_session(session_id: str):
    return {"dropped": upload_store.drop(session_id)}


# sendBeacon() can only issue POST — provide a POST alias for tab-close cleanup
@app.post("/api/session/{session_id}/drop")
def drop_session_post(session_id: str):
    return {"dropped": upload_store.drop(session_id)}


# ---------------------------------------------------------------------------
# analysis + screening
# ---------------------------------------------------------------------------
@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    df, cat, summary, is_upload = _resolve(req.source, req.session_id)
    return analysis.analyze(req, df)


@app.post("/api/screen")
def screen(req: ScreenRequest):
    df, cat, summary, is_upload = _resolve(req.source, req.session_id)
    return screening.screen(req, df, cat)


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------
def _csv_response(rows: list[dict], fieldnames: list[str], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    buf.write("﻿")  # BOM so Excel opens UTF-8 correctly
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow(r)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


def _slug(s: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in str(s))[:40].strip("_") or "analysis"


@app.post("/api/export/tumour-stats.csv")
def export_tumour_stats(req: AnalyzeRequest):
    df, *_ = _resolve(req.source, req.session_id)
    result = analysis.analyze(req, df)
    fields = [
        "tcga_code", "tcga_label", "sensitivity_rank", "n_cell_lines", "n_records",
        "mean_ln_ic50", "median_ln_ic50", "sd_ln_ic50", "sem_ln_ic50",
        "geomean_ic50_um", "median_ic50_um", "mean_ic50_um",
        "mean_auc", "median_auc", "sd_auc", "sem_auc", "mean_zscore",
    ]
    label = result["selection"]["label"]
    return _csv_response(result["tumour_stats"], fields, f"tumour_stats_{_slug(label)}.csv")


@app.post("/api/export/comparison.csv")
def export_comparison(req: AnalyzeRequest):
    df, *_ = _resolve(req.source, req.session_id)
    result = analysis.analyze(req, df)
    comp = result.get("comparison")
    if not comp or not comp.get("per_tumour_type"):
        raise HTTPException(status_code=422, detail="没有可导出的对照对比结果。")

    rows = []
    for r in comp["per_tumour_type"]:
        rows.append(
            {
                "tcga_code": r["tcga_code"],
                "tcga_label": r["tcga_label"],
                "n_cell_lines_test": r["n_cell_lines_test"],
                "n_cell_lines_control": r["n_cell_lines_control"],
                "test_geomean_ic50_um": r["test_geomean_ic50_um"],
                "control_geomean_ic50_um": r["control_geomean_ic50_um"],
                "ic50_fold_change": r["ic50_fold_change"],
                "delta_mean_ln_ic50": r["delta_mean_ln_ic50"],
                "test_mean_auc": r["test_mean_auc"],
                "control_mean_auc": r["control_mean_auc"],
                "delta_mean_auc": r["delta_mean_auc"],
                "more_potent": r["more_potent"],
                "ln_ic50_welch_p": r["ln_ic50_test_vs_control"].get("welch_p"),
                "ln_ic50_mannwhitney_p": r["ln_ic50_test_vs_control"].get("mannwhitney_p"),
                "auc_welch_p": r["auc_test_vs_control"].get("welch_p"),
                "auc_mannwhitney_p": r["auc_test_vs_control"].get("mannwhitney_p"),
            }
        )
    fields = list(rows[0].keys())
    name = f"{_slug(comp['test_label'])}_vs_{_slug(comp['control_label'])}.csv"
    return _csv_response(rows, fields, name)


@app.post("/api/export/screen.csv")
def export_screen(req: ScreenRequest):
    df, cat, *_ = _resolve(req.source, req.session_id)
    result = screening.screen(req, df, cat)
    rows = []
    for r in result["all_groups"]:
        rows.append(
            {
                "name": r["name"],
                "group_by": r["group_by"],
                "passes": r["passes"],
                "value": r["value"],
                "sem": r["sem"],
                "n_cell_lines": r["n_cell_lines"],
                "n_tumour_types_covered": r["n_tumour_types_covered"],
                "n_drugs": r["n_drugs"],
                "beats_threshold": r["beats_threshold"],
                "meets_min_cell_lines": r["meets_min_cell_lines"],
                "targets": "; ".join(r["targets"]),
                "pathways": "; ".join(r["pathways"]),
            }
        )
    fields = list(rows[0].keys()) if rows else ["name"]
    p = result["params"]
    name = f"screen_{p['group_by']}_{p['metric']}_{_slug('_'.join(p['tumour_types']))}.csv"
    return _csv_response(rows, fields, name)
