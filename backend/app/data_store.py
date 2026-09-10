"""Loads the built-in GDSC dose-response tables and builds lookup catalogs.

The bulk-download Excel files are parsed once and cached as a parquet file so
subsequent server starts are fast. The SAME normalisation / cleaning used for
user uploads (``validation.normalize_and_clean``) is applied here, so analysis
code never has to care where a DataFrame came from.

``build_catalogs(df)`` derives the drug / target / pathway / tumour-type catalogs
for *any* frame; ``catalogs()`` is the cached version for the built-in data.
"""
from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Optional

import pandas as pd

from .config import CACHE_PATH, DATA_DIR, GDSC_FILES, TCGA_LABELS
from .validation import normalize_and_clean

log = logging.getLogger("gdsc.data")

_FRAME: Optional[pd.DataFrame] = None


# ---------------------------------------------------------------------------
# Loading / caching (built-in data only)
# ---------------------------------------------------------------------------
def _build_frame() -> pd.DataFrame:
    frames = []
    for name, path in GDSC_FILES.items():
        if not path.exists():
            log.warning("Missing data file for %s: %s", name, path)
            continue
        log.info("Parsing %s ...", path.name)
        part = pd.read_excel(path, engine="openpyxl")
        part["DATASET"] = name
        frames.append(part)

    if not frames:
        raise FileNotFoundError(
            f"No GDSC data files found in {DATA_DIR}. Expected one of: "
            + ", ".join(p.name for p in GDSC_FILES.values())
        )

    raw = pd.concat(frames, ignore_index=True)
    df, report = normalize_and_clean(raw, default_dataset="GDSC")
    log.info(
        "Built-in frame: %d rows, %d drugs, %d cell lines (dropped %s)",
        len(df), df["DRUG_NAME"].nunique(), df["COSMIC_ID"].nunique(), report["dropped"],
    )
    return df


def load(force: bool = False) -> pd.DataFrame:
    global _FRAME
    if _FRAME is not None and not force:
        return _FRAME

    if CACHE_PATH.exists() and not force:
        try:
            log.info("Loading cached frame from %s", CACHE_PATH)
            _FRAME = pd.read_parquet(CACHE_PATH)
            return _FRAME
        except Exception as exc:  # noqa: BLE001
            log.warning("Failed to read cache (%s); rebuilding", exc)

    _FRAME = _build_frame()
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _FRAME.to_parquet(CACHE_PATH, index=False)
        log.info("Wrote cache to %s", CACHE_PATH)
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not write parquet cache: %s", exc)
    return _FRAME


def get_frame() -> pd.DataFrame:
    return _FRAME if _FRAME is not None else load()


# ---------------------------------------------------------------------------
# Catalog building (works on any normalised frame)
# ---------------------------------------------------------------------------
def split_targets(value: str) -> list[str]:
    """Split a PUTATIVE_TARGET string into individual gene / target tokens."""
    if not value or value in ("Unknown", "not defined", "Not defined"):
        return []
    text = re.sub(r"\([^)]*\)", " ", str(value))
    parts = re.split(r"[,;/]|\band\b", text)
    out = []
    for p in parts:
        p = p.strip().strip(".")
        if len(p) < 2 or not re.search(r"[A-Za-z]", p):
            continue
        out.append(p)
    return out


# kept as an alias for existing imports
_split_targets = split_targets


def build_catalogs(df: pd.DataFrame) -> dict:
    datasets = sorted(df["DATASET"].dropna().unique().tolist())

    drug_rows = []
    for name, grp in df.groupby("DRUG_NAME"):
        drug_rows.append(
            {
                "name": name,
                "drug_ids": sorted(int(x) for x in grp["DRUG_ID"].dropna().unique()),
                "datasets": sorted(grp["DATASET"].dropna().unique().tolist()),
                "targets": sorted(
                    {t for v in grp["PUTATIVE_TARGET"].dropna().unique() for t in split_targets(v)}
                ),
                "target_raw": sorted(grp["PUTATIVE_TARGET"].dropna().unique().tolist()),
                "pathways": sorted(grp["PATHWAY_NAME"].dropna().unique().tolist()),
                "n_cell_lines": int(grp["COSMIC_ID"].nunique()),
                "n_tumour_types": int(grp["TCGA_DESC"].nunique()),
            }
        )
    drug_rows.sort(key=lambda r: r["name"].lower())

    target_map: dict[str, set] = {}
    for name, grp in df.groupby("PUTATIVE_TARGET"):
        for t in split_targets(name):
            target_map.setdefault(t, set()).update(grp["DRUG_NAME"].unique())
    targets = [
        {"name": t, "n_drugs": len(drugs)}
        for t, drugs in sorted(target_map.items(), key=lambda kv: kv[0].lower())
        if t
    ]

    pathways = [
        {"name": name, "n_drugs": int(grp["DRUG_NAME"].nunique())}
        for name, grp in df.groupby("PATHWAY_NAME")
    ]
    pathways.sort(key=lambda r: r["name"].lower())

    tumour_types = [
        {
            "code": code,
            "label": TCGA_LABELS.get(code, code),
            "n_cell_lines": int(grp["COSMIC_ID"].nunique()),
            "datasets": sorted(grp["DATASET"].dropna().unique().tolist()),
        }
        for code, grp in df.groupby("TCGA_DESC")
    ]
    tumour_types.sort(key=lambda r: (-r["n_cell_lines"], r["code"]))

    return {
        "datasets": datasets,
        "drugs": drug_rows,
        "targets": targets,
        "pathways": pathways,
        "tumour_types": tumour_types,
    }


@lru_cache(maxsize=1)
def catalogs() -> dict:
    return build_catalogs(get_frame())


def summarize(df: pd.DataFrame) -> dict:
    out = {"n_records": int(len(df))}
    for ds, grp in df.groupby("DATASET"):
        out[str(ds)] = {
            "n_records": int(len(grp)),
            "n_drugs": int(grp["DRUG_NAME"].nunique()),
            "n_cell_lines": int(grp["COSMIC_ID"].nunique()),
            "n_tumour_types": int(grp["TCGA_DESC"].nunique()),
        }
    return out


def stats_summary() -> dict:
    return summarize(get_frame())
