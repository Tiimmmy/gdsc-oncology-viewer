"""Pydantic request / response models for the JSON API."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from .config import DEFAULT_CONTROL_DRUG, DEFAULT_DATASET, DEFAULT_MIN_CELL_LINES


class SourceMixin(BaseModel):
    # Which dataset to analyse: the bundled GDSC data or a user upload held in
    # memory for this session only.
    source: str = Field("builtin", description="'builtin' or 'upload'")
    session_id: Optional[str] = Field(None, description="required when source == 'upload'")


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------
class AnalyzeRequest(SourceMixin):
    dataset: Optional[str] = Field(DEFAULT_DATASET, description="GDSC1 / GDSC2 (built-in only)")

    drug: Optional[str] = Field(None, description="Test drug name")
    drug_id: Optional[int] = Field(None, description="Optional specific GDSC DRUG_ID")
    target: Optional[str] = Field(None, description="Putative target filter")
    pathway: Optional[str] = Field(None, description="Pathway filter")

    control_drug: Optional[str] = Field(DEFAULT_CONTROL_DRUG, description="Reference drug name")
    control_dataset: Optional[str] = Field(None, description="Dataset for the control drug")

    tumour_types: list[str] = Field(default_factory=list)
    min_cell_lines: int = Field(DEFAULT_MIN_CELL_LINES, ge=1, le=50)
    sensitivity_metric: str = Field("AUC", description="AUC or LN_IC50")
    include_points: bool = Field(True)


class ScreenRequest(SourceMixin):
    """Threshold screen: find drugs / targets / pathways whose mean sensitivity in
    the chosen tumour type(s) beats a user-defined benchmark."""

    dataset: Optional[str] = Field(DEFAULT_DATASET)
    tumour_types: list[str] = Field(default_factory=list, description="TCGA codes; >= 1 required")
    group_by: str = Field("drug", description="drug | target | pathway")
    metric: str = Field("AUC", description="AUC | IC50_UM | LN_IC50")
    threshold: float = Field(..., description="benchmark value")
    direction: str = Field("below", description="'below' = more sensitive than threshold")
    aggregate: str = Field(
        "pooled", description="'pooled' cell-line mean, or 'per_type_mean' (mean of per-type means)"
    )
    min_cell_lines: int = Field(DEFAULT_MIN_CELL_LINES, ge=1, le=200)
    limit: int = Field(400, ge=1, le=2000)


class TumourStat(BaseModel):
    tcga_code: str
    tcga_label: str
    n_cell_lines: int
    n_records: int
    mean_ln_ic50: float
    median_ln_ic50: float
    sd_ln_ic50: float
    sem_ln_ic50: float
    geomean_ic50_um: float
    median_ic50_um: float
    mean_auc: float
    median_auc: float
    sd_auc: float
    sem_auc: float
    mean_zscore: float
    sensitivity_rank: Optional[int]
