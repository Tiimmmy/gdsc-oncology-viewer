"""Configuration and static reference data for the GDSC2 sensitivity tool."""
from __future__ import annotations

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent
DATA_DIR = Path(os.environ.get("GDSC_DATA_DIR", PROJECT_DIR / "data"))
CACHE_PATH = DATA_DIR / "gdsc_combined.parquet"

# GDSC bulk-download files (release 8.5, 27Oct23). Download from
# https://www.cancerrxgene.org/downloads/bulk_download
# (direct mirror: https://cog.sanger.ac.uk/cancerrxgene/GDSC_release8.5/)
GDSC_FILES = {
    "GDSC2": DATA_DIR / "GDSC2_fitted_dose_response_27Oct23.xlsx",
    "GDSC1": DATA_DIR / "GDSC1_fitted_dose_response_27Oct23.xlsx",
}

# ---------------------------------------------------------------------------
# Analysis defaults
# ---------------------------------------------------------------------------
DEFAULT_DATASET = "GDSC2"
DEFAULT_CONTROL_DRUG = "Doxorubicin"
DEFAULT_MIN_CELL_LINES = 3      # minimum cell lines per tumour type to report stats
MAX_BOX_TUMOUR_TYPES = 40       # safety cap on categories returned for plotting
MIN_BOX_CELL_LINES = 3         # a box plot needs at least this many points to be meaningful

# ---------------------------------------------------------------------------
# User-upload handling (requirement: no caching / no persistence of user data)
# ---------------------------------------------------------------------------
UPLOAD_MAX_BYTES = 40 * 1024 * 1024      # 40 MB hard cap on an uploaded file
UPLOAD_MAX_ROWS = 3_000_000             # reject absurdly large sheets
UPLOAD_ALLOWED_EXT = {".xlsx", ".xls", ".csv"}
UPLOAD_SESSION_TTL_SECONDS = 30 * 60     # in-memory session lifetime
UPLOAD_MAX_SESSIONS = 16                 # global cap on concurrent in-memory datasets

# Plausibility bounds used to filter abnormal / illegal values from any dataset.
AUC_MIN, AUC_MAX = 0.0, 1.0
LN_IC50_ABS_MAX = 50.0                   # |ln(IC50 uM)| beyond this is not real data
IC50_UM_MIN = 1e-12                      # IC50 must be strictly positive and finite

# ---------------------------------------------------------------------------
# TCGA study-code -> readable label. Codes follow the TCGA study abbreviations
# used by GDSC (a few GDSC-specific buckets such as COREAD / UNCLASSIFIED).
# ---------------------------------------------------------------------------
TCGA_LABELS = {
    "ACC": "Adrenocortical carcinoma",
    "ALL": "Acute lymphoblastic leukemia",
    "BLCA": "Bladder urothelial carcinoma",
    "BRCA": "Breast invasive carcinoma",
    "CESC": "Cervical squamous cell carcinoma / endocervical adenocarcinoma",
    "CLL": "Chronic lymphocytic leukemia",
    "COREAD": "Colorectal adenocarcinoma",
    "DLBC": "Diffuse large B-cell lymphoma",
    "ESCA": "Esophageal carcinoma",
    "GBM": "Glioblastoma multiforme",
    "HNSC": "Head and neck squamous cell carcinoma",
    "KIRC": "Kidney renal clear cell carcinoma",
    "LAML": "Acute myeloid leukemia",
    "LCML": "Chronic myelogenous leukemia",
    "LGG": "Brain lower grade glioma",
    "LIHC": "Liver hepatocellular carcinoma",
    "LUAD": "Lung adenocarcinoma",
    "LUSC": "Lung squamous cell carcinoma",
    "MB": "Medulloblastoma",
    "MESO": "Mesothelioma",
    "MM": "Multiple myeloma",
    "NB": "Neuroblastoma",
    "OV": "Ovarian serous cystadenocarcinoma",
    "PAAD": "Pancreatic adenocarcinoma",
    "PRAD": "Prostate adenocarcinoma",
    "SCLC": "Small cell lung carcinoma",
    "SKCM": "Skin cutaneous melanoma",
    "STAD": "Stomach adenocarcinoma",
    "THCA": "Thyroid carcinoma",
    "UCEC": "Uterine corpus endometrial carcinoma",
    "OTHER": "Other / not otherwise specified",
    "UNCLASSIFIED": "Unclassified",
}


def tcga_label(code: str) -> str:
    return TCGA_LABELS.get(str(code).upper(), str(code))
