"""File-format checks, required-field validation and value cleaning.

Shared by the built-in GDSC loader (``data_store``) and the user-upload path
(``upload_store`` / ``POST /api/upload``). The same normalisation is applied to
both so downstream analysis code never has to special-case a data source.

Cleaning rules
--------------
* Column names are matched case/whitespace-insensitively against a set of known
  aliases and renamed to the canonical GDSC names.
* Required logical fields: a drug identifier, a cell-line identifier, a tumour
  type, and a potency readout (LN_IC50 / IC50 and AUC).
* Rows are dropped (and counted per reason) when a required field is null, when
  AUC falls outside [0, 1], or when IC50 is non-positive / non-finite / absurd.
"""
from __future__ import annotations

import io
import math
import re
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from .config import (
    AUC_MIN,
    AUC_MAX,
    IC50_UM_MIN,
    LN_IC50_ABS_MAX,
    UPLOAD_ALLOWED_EXT,
    UPLOAD_MAX_ROWS,
    tcga_label,
)


class ValidationError(ValueError):
    """User-facing problem with an uploaded file. ``detail`` is a dict for the UI."""

    def __init__(self, message: str, detail: Optional[dict] = None):
        super().__init__(message)
        self.message = message
        self.detail = detail or {}


# ---------------------------------------------------------------------------
# column aliasing
# ---------------------------------------------------------------------------
def _norm_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(name).strip().lower())


# canonical name -> accepted aliases (normalised on both sides at match time)
_ALIASES: dict[str, list[str]] = {
    "DATASET": ["dataset", "screen", "gdscversion", "source"],
    "DRUG_NAME": ["drugname", "drug", "compound", "compoundname", "drugid_name", "name"],
    "DRUG_ID": ["drugid", "drugidnumber", "compoundid"],
    "COSMIC_ID": ["cosmicid", "cosmic", "cosmicidnumber", "cosmicsampleid"],
    "CELL_LINE_NAME": ["celllinename", "cellline", "cellline name", "sample", "samplename", "model", "modelname"],
    "SANGER_MODEL_ID": ["sangermodelid", "modelid", "sidm"],
    "TCGA_DESC": [
        "tcgadesc", "tcga", "tcgalabel", "tcgaclassification", "cancertype",
        "cancertypematchingtcgalabel", "tcgatype", "tumourtype", "tumortype",
        "diseasearea", "tissue", "gdsctissuedescriptor1", "gdsctissuedescriptor2",
    ],
    "PUTATIVE_TARGET": ["putativetarget", "target", "targets", "drugtarget", "targetpathway"],
    "PATHWAY_NAME": ["pathwayname", "pathway", "targetpathwayname"],
    "LN_IC50": ["lnic50", "logic50", "naturallogic50", "lnic50um"],
    "IC50": ["ic50", "ic50um", "ic50uM", "ic50published", "ic50nm", "ic50value"],
    "AUC": ["auc", "areaunderthecurve", "aucvalue", "activityarea"],
    "Z_SCORE": ["zscore", "z"],
    "MIN_CONC": ["minconc", "minconcentration", "concentrationmin"],
    "MAX_CONC": ["maxconc", "maxconcentration", "concentrationmax"],
    "RMSE": ["rmse"],
}


def _map_columns(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    lookup = {}
    for canon, aliases in _ALIASES.items():
        keys = {_norm_key(canon)} | {_norm_key(a) for a in aliases}
        for col in df.columns:
            if _norm_key(col) in keys and canon not in lookup.values():
                lookup[col] = canon
                break
    renamed = df.rename(columns=lookup)
    # drop duplicate canonical columns keeping the first
    renamed = renamed.loc[:, ~renamed.columns.duplicated()]
    return renamed, {v: k for k, v in lookup.items()}


# ---------------------------------------------------------------------------
# file reading
# ---------------------------------------------------------------------------
def read_table(raw: bytes, filename: str) -> pd.DataFrame:
    """Parse an uploaded file into a DataFrame or raise ValidationError."""
    ext = Path(filename or "").suffix.lower()
    if ext not in UPLOAD_ALLOWED_EXT:
        raise ValidationError(
            f"不支持的文件类型 “{ext or '未知'}”。请上传 .xlsx / .xls / .csv 文件。"
        )
    if not raw:
        raise ValidationError("文件为空。")

    try:
        if ext == ".csv":
            df = pd.read_csv(io.BytesIO(raw))
        else:
            engine = "openpyxl" if ext == ".xlsx" else None
            xls = pd.ExcelFile(io.BytesIO(raw), engine=engine)
            # pick the sheet that looks most like a dose-response table
            best, best_score = xls.sheet_names[0], -1
            for sheet in xls.sheet_names:
                head = xls.parse(sheet, nrows=0)
                score = sum(
                    1
                    for c in head.columns
                    if _norm_key(c) in {_norm_key(k) for k in _ALIASES}
                    or any(_norm_key(c) == _norm_key(a) for al in _ALIASES.values() for a in al)
                )
                if score > best_score:
                    best, best_score = sheet, score
            df = xls.parse(best)
    except ValidationError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ValidationError(
            "文件无法解析为数据表，请确认文件未损坏且为标准 Excel/CSV 格式。",
            {"parser_error": str(exc)[:300]},
        )

    if df is None or df.shape[1] == 0:
        raise ValidationError("未能从文件中读取到任何列。")
    if len(df) > UPLOAD_MAX_ROWS:
        raise ValidationError(f"数据行数过多（{len(df):,}），上限为 {UPLOAD_MAX_ROWS:,} 行。")
    if len(df) == 0:
        raise ValidationError("文件中没有数据行（仅有表头）。")
    return df


# ---------------------------------------------------------------------------
# normalisation + value cleaning (shared)
# ---------------------------------------------------------------------------
def normalize_and_clean(
    df: pd.DataFrame,
    *,
    default_dataset: str = "UPLOAD",
    strict: bool = True,
) -> tuple[pd.DataFrame, dict]:
    """Return (clean_df, report). Raises ValidationError when required fields are
    absent or nothing survives cleaning (``strict``)."""
    report: dict = {
        "rows_in": int(len(df)),
        "columns_in": [str(c) for c in df.columns],
        "warnings": [],
        "dropped": {},
        "column_mapping": {},
    }

    df, mapping = _map_columns(df)
    report["column_mapping"] = mapping
    report["columns_detected"] = sorted(set(_ALIASES) & set(df.columns))

    # ---- required logical fields ------------------------------------
    missing = []
    if "DRUG_NAME" not in df.columns and "DRUG_ID" not in df.columns:
        missing.append("药物名称 (DRUG_NAME)")
    cell_cols = [c for c in ("COSMIC_ID", "CELL_LINE_NAME", "SANGER_MODEL_ID") if c in df.columns]
    if not cell_cols:
        missing.append("细胞系标识 (CELL_LINE_NAME / COSMIC_ID)")
    if "TCGA_DESC" not in df.columns:
        missing.append("肿瘤类型 (TCGA_DESC / Cancer Type)")
    if "AUC" not in df.columns:
        missing.append("AUC")
    if "LN_IC50" not in df.columns and "IC50" not in df.columns:
        missing.append("LN_IC50 或 IC50")
    if missing:
        raise ValidationError(
            "文件缺少必填字段：" + "、".join(missing),
            {
                "missing_fields": missing,
                "columns_in": report["columns_in"],
                "columns_detected": report["columns_detected"],
            },
        )

    # ---- assemble canonical columns -------------------------------
    if "DRUG_NAME" not in df.columns:
        df["DRUG_NAME"] = df["DRUG_ID"].astype("string")
    if "DATASET" not in df.columns:
        df["DATASET"] = default_dataset
        report["warnings"].append(f"未发现 DATASET 列，已统一标记为 “{default_dataset}”。")

    if "CELL_LINE_NAME" not in df.columns:
        src = "COSMIC_ID" if "COSMIC_ID" in df.columns else "SANGER_MODEL_ID"
        df["CELL_LINE_NAME"] = df[src].astype("string")
    if "SANGER_MODEL_ID" not in df.columns:
        df["SANGER_MODEL_ID"] = pd.NA

    for col, default in (("PUTATIVE_TARGET", "Unknown"), ("PATHWAY_NAME", "Unclassified")):
        if col not in df.columns:
            df[col] = default
            report["warnings"].append(f"未发现 {col} 列，相关筛选将不可用。")
    for col in ("Z_SCORE", "RMSE", "MIN_CONC", "MAX_CONC", "DRUG_ID"):
        if col not in df.columns:
            df[col] = np.nan

    # ---- numeric coercion ----------------------------------------
    df["AUC"] = pd.to_numeric(df["AUC"], errors="coerce")
    if "IC50" in df.columns:
        df["IC50"] = pd.to_numeric(df["IC50"], errors="coerce")
    if "LN_IC50" in df.columns:
        df["LN_IC50"] = pd.to_numeric(df["LN_IC50"], errors="coerce")
    else:
        with np.errstate(all="ignore"):
            df["LN_IC50"] = np.log(df["IC50"].where(df["IC50"] > 0))
        report["warnings"].append("未发现 LN_IC50 列，已按 IC50 单位为 µM 取自然对数推导。")
    for col in ("Z_SCORE", "DRUG_ID", "COSMIC_ID"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # ---- string normalisation ----------------------------------
    df["TCGA_DESC"] = (
        df["TCGA_DESC"].astype("string").str.strip().str.upper().replace(
            {"": pd.NA, "NA": pd.NA, "NAN": pd.NA, "NONE": pd.NA, "UNKNOWN": pd.NA}
        )
    )
    df["TCGA_DESC"] = df["TCGA_DESC"].fillna("UNCLASSIFIED")
    for col in ("DRUG_NAME", "PUTATIVE_TARGET", "PATHWAY_NAME", "CELL_LINE_NAME", "DATASET"):
        df[col] = df[col].astype("string").str.strip()
    df["PUTATIVE_TARGET"] = df["PUTATIVE_TARGET"].fillna("Unknown")
    df["PATHWAY_NAME"] = df["PATHWAY_NAME"].fillna("Unclassified")

    keep = [
        "DATASET", "COSMIC_ID", "CELL_LINE_NAME", "SANGER_MODEL_ID", "TCGA_DESC",
        "DRUG_ID", "DRUG_NAME", "PUTATIVE_TARGET", "PATHWAY_NAME",
        "MIN_CONC", "MAX_CONC", "LN_IC50", "AUC", "RMSE", "Z_SCORE",
    ]
    df = df[[c for c in keep if c in df.columns]].copy()

    # ---- row filtering, counted per reason -------------------------
    n0 = len(df)
    req_null = df["DRUG_NAME"].isna() | df["TCGA_DESC"].isna() | df["LN_IC50"].isna() | df["AUC"].isna()
    df = df[~req_null]
    report["dropped"]["missing_required"] = int(n0 - len(df))

    n1 = len(df)
    bad_auc = ~df["AUC"].between(AUC_MIN - 1e-6, AUC_MAX + 1e-6)
    df = df[~bad_auc]
    report["dropped"]["auc_out_of_range"] = int(n1 - len(df))
    df["AUC"] = df["AUC"].clip(AUC_MIN, AUC_MAX)

    n2 = len(df)
    with np.errstate(all="ignore"):
        ic50_um = np.exp(df["LN_IC50"].to_numpy(dtype=float))
    bad_ic50 = (
        ~np.isfinite(df["LN_IC50"].to_numpy(dtype=float))
        | (np.abs(df["LN_IC50"].to_numpy(dtype=float)) > LN_IC50_ABS_MAX)
        | ~np.isfinite(ic50_um)
        | (ic50_um < IC50_UM_MIN)
    )
    df = df[~bad_ic50]
    report["dropped"]["ic50_illegal_or_extreme"] = int(n2 - len(df))

    # non-finite Z-score -> NaN (kept)
    if "Z_SCORE" in df.columns:
        z = df["Z_SCORE"].to_numpy(dtype=float)
        df.loc[~np.isfinite(z), "Z_SCORE"] = np.nan

    if strict and df.empty:
        raise ValidationError(
            "清洗后没有有效数据行（所有行的必填字段缺失或数值非法）。",
            {"dropped": report["dropped"], "rows_in": report["rows_in"]},
        )

    # ---- synthesise a stable cell-line key when COSMIC_ID absent ---
    if "COSMIC_ID" not in df.columns or df["COSMIC_ID"].isna().all():
        df["COSMIC_ID"] = df["CELL_LINE_NAME"].astype("category").cat.codes.astype("Int64")
        report["warnings"].append("未发现有效 COSMIC_ID，已按细胞系名称生成内部编号。")
    else:
        df["COSMIC_ID"] = df["COSMIC_ID"].astype("Int64")
    df["DRUG_ID"] = pd.to_numeric(df["DRUG_ID"], errors="coerce").astype("Int64")

    # ---- collapse replicate screens ------------------------------
    before = len(df)
    agg = {
        "LN_IC50": "mean", "AUC": "mean", "Z_SCORE": "mean", "RMSE": "mean",
        "MIN_CONC": "min", "MAX_CONC": "max", "CELL_LINE_NAME": "first",
        "SANGER_MODEL_ID": "first", "TCGA_DESC": "first",
        "PUTATIVE_TARGET": "first", "PATHWAY_NAME": "first", "DRUG_ID": "first",
    }
    df = df.groupby(["DATASET", "DRUG_NAME", "COSMIC_ID"], as_index=False, dropna=False).agg(
        {k: v for k, v in agg.items() if k in df.columns}
    )
    report["dropped"]["replicate_rows_collapsed"] = int(before - len(df))

    df["IC50_UM"] = np.exp(df["LN_IC50"])
    df["TCGA_LABEL"] = df["TCGA_DESC"].map(tcga_label)
    df = df.reset_index(drop=True)

    report["rows_out"] = int(len(df))
    report["n_drugs"] = int(df["DRUG_NAME"].nunique())
    report["n_cell_lines"] = int(df["COSMIC_ID"].nunique())
    report["n_tumour_types"] = int(df["TCGA_DESC"].nunique())
    report["datasets"] = sorted(df["DATASET"].dropna().unique().tolist())
    return df, report
