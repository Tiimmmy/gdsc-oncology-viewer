"""Threshold screen (requirement 1).

Given one or more TCGA tumour types and a user-defined sensitivity benchmark,
return the drugs / targets / pathways whose **mean** sensitivity in those tumour
types beats the threshold. Pure mean comparison — no modelling.
"""
from __future__ import annotations

import math
import warnings

import numpy as np
import pandas as pd

from .analysis import AnalysisError, _f, _sem
from .config import TCGA_LABELS
from .data_store import split_targets

_METRICS = {
    "AUC": ("AUC", "均值 AUC", "越低越敏感"),
    "IC50_UM": ("IC50_UM", "几何均值 IC50 (µM)", "越低越敏感"),
    "LN_IC50": ("LN_IC50", "均值 ln(IC50)", "越低越敏感"),
}


def screen(req, df: pd.DataFrame, catalogs: dict) -> dict:
    if req.metric.upper() not in _METRICS:
        raise AnalysisError(f"未知指标 “{req.metric}”。可选：AUC / IC50_UM / LN_IC50。")
    metric = req.metric.upper()
    group_by = req.group_by.lower()
    if group_by not in ("drug", "target", "pathway"):
        raise AnalysisError("group_by 必须为 drug / target / pathway。")
    if not req.tumour_types:
        raise AnalysisError("阈值筛选至少需要选择 1 个肿瘤类型。")

    codes = [c.strip().upper() for c in req.tumour_types if c.strip()]
    available = set(df["DATASET"].unique())
    sub = df
    if req.dataset in available:
        sub = df[df["DATASET"] == req.dataset]
    present = set(sub["TCGA_DESC"].unique())
    missing_codes = [c for c in codes if c not in present]
    codes = [c for c in codes if c in present]
    if not codes:
        raise AnalysisError(
            "所选肿瘤类型在当前数据中没有记录："
            + "、".join(missing_codes)
        )

    sub = sub[sub["TCGA_DESC"].isin(codes)]
    if sub.empty:
        raise AnalysisError("所选肿瘤类型在当前数据中没有剂量-反应记录。")

    direction = req.direction.lower()
    if direction not in ("below", "above"):
        direction = "below"

    # ---- build the groups ----------------------------------------
    if group_by == "drug":
        grouped = list(sub.groupby("DRUG_NAME"))
    elif group_by == "pathway":
        grouped = list(sub.groupby("PATHWAY_NAME"))
    else:  # target
        buckets: dict[str, list[pd.DataFrame]] = {}
        for raw, grp in sub.groupby("PUTATIVE_TARGET"):
            for tok in split_targets(raw):
                buckets.setdefault(tok, []).append(grp)
        grouped = [(k, pd.concat(v, ignore_index=True)) for k, v in buckets.items()]

    rows = []
    for name, grp in grouped:
        if metric == "IC50_UM":
            vals = grp["LN_IC50"].to_numpy(dtype=float)          # aggregate in log space
        else:
            vals = grp[metric].to_numpy(dtype=float)
        vals = vals[np.isfinite(vals)]
        if vals.size == 0:
            continue
        n_cl = int(grp["COSMIC_ID"].nunique())

        per_type = []
        per_type_means = []
        for code in codes:
            g = grp[grp["TCGA_DESC"] == code]
            if g.empty:
                continue
            col = "LN_IC50" if metric == "IC50_UM" else metric
            a = g[col].to_numpy(dtype=float)
            a = a[np.isfinite(a)]
            if a.size == 0:
                continue
            m = float(np.mean(a))
            per_type_means.append(m)
            per_type.append(
                {
                    "tcga_code": code,
                    "tcga_label": TCGA_LABELS.get(code, code),
                    "n_cell_lines": int(g["COSMIC_ID"].nunique()),
                    "value": _f(math.exp(m) if metric == "IC50_UM" else m),
                }
            )

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            if req.aggregate == "per_type_mean" and per_type_means:
                mean_log_or_val = float(np.mean(per_type_means))
            else:
                mean_log_or_val = float(np.mean(vals))
        value = math.exp(mean_log_or_val) if metric == "IC50_UM" else mean_log_or_val
        sem = _sem(np.exp(vals) if metric == "IC50_UM" else vals)

        passes_n = n_cl >= req.min_cell_lines
        beats = value < req.threshold if direction == "below" else value > req.threshold
        rows.append(
            {
                "name": name,
                "group_by": group_by,
                "n_cell_lines": n_cl,
                "n_records": int(len(grp)),
                "n_tumour_types_covered": len(per_type),
                "value": _f(value),
                "sem": _f(sem),
                "passes": bool(beats and passes_n),
                "beats_threshold": bool(beats),
                "meets_min_cell_lines": bool(passes_n),
                "per_tumour_type": per_type,
                "targets": sorted(
                    {t for v in grp["PUTATIVE_TARGET"].dropna().unique() for t in split_targets(v)}
                )[:8]
                if group_by == "drug"
                else [],
                "pathways": sorted(grp["PATHWAY_NAME"].dropna().unique().tolist())[:5]
                if group_by == "drug"
                else [],
                "n_drugs": int(grp["DRUG_NAME"].nunique()),
            }
        )

    rows.sort(key=lambda r: (r["value"] if r["value"] is not None else math.inf))
    if direction == "above":
        rows.sort(key=lambda r: (-(r["value"] if r["value"] is not None else -math.inf)))

    hits = [r for r in rows if r["passes"]]
    col, label, note = _METRICS[metric]

    return {
        "params": {
            "dataset": req.dataset if req.dataset in available else None,
            "tumour_types": codes,
            "missing_tumour_types": missing_codes,
            "group_by": group_by,
            "metric": metric,
            "metric_label": label,
            "threshold": req.threshold,
            "direction": direction,
            "aggregate": req.aggregate,
            "min_cell_lines": req.min_cell_lines,
        },
        "summary": {
            "n_evaluated": len(rows),
            "n_hits": len(hits),
            "n_beats_threshold": sum(1 for r in rows if r["beats_threshold"]),
            "best": hits[0] if hits else (rows[0] if rows else None),
        },
        "hits": hits[: req.limit],
        "all_groups": rows[: req.limit],
    }
