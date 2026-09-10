"""Mean-sensitivity analysis over the GDSC fitted dose-response data.

All computation is deliberately simple and transparent:
  * group cell lines by TCGA tumour type,
  * summarise LN(IC50), IC50 (uM) and AUC per group (mean / median / SD / SEM),
  * rank tumour types by mean sensitivity,
  * compare the test drug against a control drug per tumour type,
  * run standard group-difference tests (ANOVA / Kruskal-Wallis across tumour
    types; Welch t-test + Mann-Whitney for test-vs-control).

No machine learning, no mutation / outcome association.
"""
from __future__ import annotations

import math
import re
import warnings
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats

from .config import (
    MAX_BOX_TUMOUR_TYPES,
    MIN_BOX_CELL_LINES,
    TCGA_LABELS,
)


class AnalysisError(ValueError):
    """Raised for user-facing problems (unknown drug, empty selection, ...)."""


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _f(x) -> Optional[float]:
    """JSON-safe float (NaN / inf -> None)."""
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _sem(a: np.ndarray) -> float:
    a = a[np.isfinite(a)]
    if a.size < 2:
        return float("nan")
    return float(np.std(a, ddof=1) / math.sqrt(a.size))


def _select(
    df: pd.DataFrame,
    dataset: Optional[str],
    drug: Optional[str],
    drug_id: Optional[int],
    target: Optional[str],
    pathway: Optional[str],
) -> pd.DataFrame:
    sub = df
    if dataset and dataset in set(df["DATASET"].unique()):
        sub = df[df["DATASET"] == dataset]

    if drug:
        sub = sub[sub["DRUG_NAME"].str.lower() == drug.strip().lower()]
        if sub.empty:
            raise AnalysisError(
                f"未找到药物 “{drug}”。请检查拼写，或改用靶点 / 通路筛选。"
            )
    if drug_id is not None:
        sub = sub[sub["DRUG_ID"] == drug_id]
    if target:
        sub = sub[sub["PUTATIVE_TARGET"].str.contains(re.escape(target.strip()), case=False, na=False)]
        if sub.empty:
            raise AnalysisError(f"未找到靶点包含 “{target}” 的药物记录。")
    if pathway:
        sub = sub[sub["PATHWAY_NAME"].str.lower() == pathway.strip().lower()]
        if sub.empty:
            raise AnalysisError(f"未找到通路 “{pathway}” 的药物记录。")

    if sub.empty:
        raise AnalysisError("没有符合所选条件的剂量-反应记录。")
    return sub


def _group_stats(sub: pd.DataFrame, min_cell_lines: int, rank_metric: str) -> list[dict]:
    rows = []
    for code, grp in sub.groupby("TCGA_DESC"):
        ln = grp["LN_IC50"].to_numpy(dtype=float)
        auc = grp["AUC"].to_numpy(dtype=float)
        n_cl = int(grp["COSMIC_ID"].nunique())
        rows.append(
            {
                "tcga_code": code,
                "tcga_label": TCGA_LABELS.get(code, code),
                "n_cell_lines": n_cl,
                "n_records": int(len(grp)),
                "mean_ln_ic50": _f(np.mean(ln)),
                "median_ln_ic50": _f(np.median(ln)),
                "sd_ln_ic50": _f(np.std(ln, ddof=1) if ln.size > 1 else np.nan),
                "sem_ln_ic50": _f(_sem(ln)),
                "geomean_ic50_um": _f(math.exp(np.mean(ln))) if ln.size else None,
                "median_ic50_um": _f(math.exp(np.median(ln))) if ln.size else None,
                "mean_ic50_um": _f(np.mean(np.exp(ln))) if ln.size else None,
                "mean_auc": _f(np.mean(auc)),
                "median_auc": _f(np.median(auc)),
                "sd_auc": _f(np.std(auc, ddof=1) if auc.size > 1 else np.nan),
                "sem_auc": _f(_sem(auc)),
                "mean_zscore": _f(np.mean(grp["Z_SCORE"].to_numpy(dtype=float))),
            }
        )

    reported = [r for r in rows if r["n_cell_lines"] >= min_cell_lines]
    reported.sort(key=lambda r: (r["mean_auc"] if rank_metric == "AUC" else r["mean_ln_ic50"]))
    for i, r in enumerate(reported, start=1):
        r["sensitivity_rank"] = i

    below = [r for r in rows if r["n_cell_lines"] < min_cell_lines]
    below.sort(key=lambda r: r["tcga_code"])
    for r in below:
        r["sensitivity_rank"] = None

    return reported + below


def _across_group_tests(sub: pd.DataFrame, min_cell_lines: int) -> dict:
    groups_ln, groups_auc, labels = [], [], []
    for code, grp in sub.groupby("TCGA_DESC"):
        # a group needs >= 2 observations to contribute variance to the test
        if grp["COSMIC_ID"].nunique() < max(2, min_cell_lines):
            continue
        groups_ln.append(grp["LN_IC50"].to_numpy(dtype=float))
        groups_auc.append(grp["AUC"].to_numpy(dtype=float))
        labels.append(code)

    out: dict = {"n_groups": len(labels), "groups": labels}
    if len(labels) < 2:
        out["note"] = "可比较的肿瘤类型不足 2 个（每组需 ≥2 个细胞系），无法进行跨癌种差异检验。"
        return out

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            f_ln, p_ln = stats.f_oneway(*groups_ln)
            f_auc, p_auc = stats.f_oneway(*groups_auc)
            h_ln, kp_ln = stats.kruskal(*groups_ln)
            h_auc, kp_auc = stats.kruskal(*groups_auc)
    except Exception as exc:  # noqa: BLE001
        out["note"] = f"差异检验无法完成：{exc}"
        return out

    out.update(
        {
            "anova_ln_ic50": {"F": _f(f_ln), "p": _f(p_ln)},
            "anova_auc": {"F": _f(f_auc), "p": _f(p_auc)},
            "kruskal_ln_ic50": {"H": _f(h_ln), "p": _f(kp_ln)},
            "kruskal_auc": {"H": _f(h_auc), "p": _f(kp_auc)},
        }
    )
    return out


def _points(sub: pd.DataFrame, codes: list[str]) -> dict:
    out: dict[str, list] = {}
    for code in codes:
        grp = sub[sub["TCGA_DESC"] == code]
        pts = []
        for _, r in grp.iterrows():
            pts.append(
                {
                    "cell_line": r["CELL_LINE_NAME"],
                    "cosmic_id": int(r["COSMIC_ID"]) if pd.notna(r["COSMIC_ID"]) else None,
                    "drug": r["DRUG_NAME"],
                    "ln_ic50": _f(r["LN_IC50"]),
                    "ic50_um": _f(r["IC50_UM"]),
                    "auc": _f(r["AUC"]),
                    "z_score": _f(r["Z_SCORE"]),
                }
            )
        pts.sort(key=lambda p: (p["auc"] if p["auc"] is not None else 1e9))
        out[code] = pts
    return out


def _welch_and_mwu(a: np.ndarray, b: np.ndarray) -> dict:
    a = a[np.isfinite(a)]
    b = b[np.isfinite(b)]
    res = {"n_test": int(a.size), "n_control": int(b.size)}
    if a.size < 2 or b.size < 2:
        res["note"] = "Not enough cell lines for a statistical test."
        return res
    t, p = stats.ttest_ind(a, b, equal_var=False)
    try:
        u, pu = stats.mannwhitneyu(a, b, alternative="two-sided")
    except ValueError:
        u, pu = float("nan"), float("nan")
    res.update(
        {
            "welch_t": _f(t),
            "welch_p": _f(p),
            "mannwhitney_u": _f(u),
            "mannwhitney_p": _f(pu),
            "mean_diff": _f(np.mean(a) - np.mean(b)),
        }
    )
    return res


# ---------------------------------------------------------------------------
# main entry point
# ---------------------------------------------------------------------------
def analyze(req, df: pd.DataFrame) -> dict:
    available = set(df["DATASET"].unique())
    dataset = req.dataset if (req.dataset in available) else None
    control_dataset = req.control_dataset if (req.control_dataset in available) else dataset
    control_name = (req.control_drug or "").strip() or None

    if not (req.drug or req.target or req.pathway):
        raise AnalysisError("请至少选择一个药物、靶点或通路。")

    test = _select(df, dataset, req.drug, req.drug_id, req.target, req.pathway)

    # ----- what exactly did we select? --------------------------------
    test_drugs = sorted(test["DRUG_NAME"].unique().tolist())
    selection = {
        "dataset": dataset,
        "drug": req.drug,
        "drug_id": req.drug_id,
        "target": req.target,
        "pathway": req.pathway,
        "resolved_drugs": test_drugs,
        "n_drugs": len(test_drugs),
        "n_records": int(len(test)),
        "n_cell_lines": int(test["COSMIC_ID"].nunique()),
        "n_tumour_types": int(test["TCGA_DESC"].nunique()),
        "targets": sorted(test["PUTATIVE_TARGET"].dropna().unique().tolist()),
        "pathways": sorted(test["PATHWAY_NAME"].dropna().unique().tolist()),
        "label": req.drug
        or (f"靶点：{req.target}" if req.target else f"通路：{req.pathway}"),
    }

    rank_metric = "AUC" if req.sensitivity_metric.upper() == "AUC" else "LN_IC50"
    test_stats = _group_stats(test, req.min_cell_lines, rank_metric)
    group_tests = _across_group_tests(test, req.min_cell_lines)

    # ----- tumour types to expose for plotting -----------------------
    if req.tumour_types:
        focus_codes = [c.upper() for c in req.tumour_types]
    else:
        focus_codes = [
            r["tcga_code"]
            for r in test_stats
            if r["sensitivity_rank"] is not None
        ][:MAX_BOX_TUMOUR_TYPES]

    focus_codes = [c for c in focus_codes if c in set(test["TCGA_DESC"])]

    # ----- control drug ---------------------------------------------
    control_block = None
    comparison = None
    if control_name:
        ctrl = None
        try:
            ctrl = _select(df, control_dataset, control_name, None, None, None)
        except AnalysisError:
            # fall back to any dataset that has the control drug
            for alt in sorted(df["DATASET"].unique()):
                if alt == control_dataset:
                    continue
                try:
                    ctrl = _select(df, alt, control_name, None, None, None)
                    control_dataset = alt
                    break
                except AnalysisError:
                    continue
        if ctrl is None:
            control_block = {
                "drug": control_name,
                "dataset": req.control_dataset or dataset,
                "error": f"对照药 “{control_name}” 在当前数据中不存在，已跳过对照对比。",
            }
        else:
            ctrl_stats = _group_stats(ctrl, req.min_cell_lines, rank_metric)
            control_block = {
                "drug": control_name,
                "dataset": control_dataset,
                "n_records": int(len(ctrl)),
                "n_cell_lines": int(ctrl["COSMIC_ID"].nunique()),
                "n_tumour_types": int(ctrl["TCGA_DESC"].nunique()),
                "targets": sorted(ctrl["PUTATIVE_TARGET"].dropna().unique().tolist()),
                "pathways": sorted(ctrl["PATHWAY_NAME"].dropna().unique().tolist()),
                "stats": ctrl_stats,
                "cross_dataset": control_dataset != dataset,
            }
            comparison = _build_comparison(
                test, ctrl, focus_codes, req.min_cell_lines, selection["label"], control_name
            )

    # ----- plotting payload ---------------------------------------
    points = {"test": {}, "control": {}}
    if req.include_points:
        points["test"] = _points(test, focus_codes)
        if control_name and control_block and "error" not in control_block:
            points["control"] = _points(ctrl, focus_codes)

    stats_by_code = {r["tcga_code"]: r for r in test_stats}
    box_summary = [stats_by_code[c] for c in focus_codes if c in stats_by_code]

    # ----- visualisation guidance (requirement 3: full-scenario fallbacks) --
    counts = {r["tcga_code"]: r["n_cell_lines"] for r in test_stats}
    box_ok = [c for c in focus_codes if counts.get(c, 0) >= MIN_BOX_CELL_LINES]
    box_thin = [
        {"tcga_code": c, "n_cell_lines": counts.get(c, 0)}
        for c in focus_codes
        if counts.get(c, 0) < MIN_BOX_CELL_LINES
    ]
    ranked_stats = [r for r in test_stats if r["sensitivity_rank"] is not None]
    plot_guidance = {
        "box_min_cell_lines": MIN_BOX_CELL_LINES,
        "boxplot_codes": box_ok,
        "insufficient_codes": box_thin,
        "can_boxplot": len(box_ok) >= 1,
        "can_distribution": len(ranked_stats) >= 1,
        "can_comparison": bool(comparison and comparison.get("per_tumour_type")),
        "messages": [],
    }
    if not plot_guidance["can_boxplot"]:
        plot_guidance["messages"].append(
            f"所选肿瘤类型的细胞系数均少于 {MIN_BOX_CELL_LINES}，样本量不足以生成箱线图，"
            "已改为仅展示统计表。"
        )
    elif box_thin:
        plot_guidance["messages"].append(
            "以下肿瘤类型细胞系过少，已从箱线图中屏蔽："
            + "、".join(f"{d['tcga_code']}(n={d['n_cell_lines']})" for d in box_thin)
        )

    warnings_out = list(getattr(req, "_warnings", []) or [])
    if dataset is None and req.dataset and req.source == "builtin":
        warnings_out.append(f"数据集 “{req.dataset}” 不存在，已使用全部数据。")

    return {
        "selection": selection,
        "control": control_block,
        "sensitivity_metric": rank_metric,
        "min_cell_lines": req.min_cell_lines,
        "tumour_stats": test_stats,
        "focus_codes": focus_codes,
        "box_summary": box_summary,
        "group_difference_tests": group_tests,
        "comparison": comparison,
        "points": points,
        "plot_guidance": plot_guidance,
        "warnings": warnings_out,
        "most_sensitive": ranked_stats[0] if ranked_stats else None,
        "least_sensitive": ranked_stats[-1] if ranked_stats else None,
    }


def _build_comparison(
    test: pd.DataFrame,
    ctrl: pd.DataFrame,
    codes: list[str],
    min_cell_lines: int,
    test_label: str,
    control_label: str,
) -> dict:
    per_type = []
    all_codes = codes or sorted(set(test["TCGA_DESC"]) & set(ctrl["TCGA_DESC"]))
    for code in all_codes:
        t = test[test["TCGA_DESC"] == code]
        c = ctrl[ctrl["TCGA_DESC"] == code]
        if t.empty or c.empty:
            continue
        t_ln = t["LN_IC50"].to_numpy(dtype=float)
        c_ln = c["LN_IC50"].to_numpy(dtype=float)
        t_auc = t["AUC"].to_numpy(dtype=float)
        c_auc = c["AUC"].to_numpy(dtype=float)
        d_ln = float(np.mean(t_ln) - np.mean(c_ln))
        row = {
            "tcga_code": code,
            "tcga_label": TCGA_LABELS.get(code, code),
            "n_cell_lines_test": int(t["COSMIC_ID"].nunique()),
            "n_cell_lines_control": int(c["COSMIC_ID"].nunique()),
            "test_mean_ln_ic50": _f(np.mean(t_ln)),
            "control_mean_ln_ic50": _f(np.mean(c_ln)),
            "test_sem_ln_ic50": _f(_sem(t_ln)),
            "control_sem_ln_ic50": _f(_sem(c_ln)),
            "test_geomean_ic50_um": _f(math.exp(np.mean(t_ln))),
            "control_geomean_ic50_um": _f(math.exp(np.mean(c_ln))),
            "test_mean_auc": _f(np.mean(t_auc)),
            "control_mean_auc": _f(np.mean(c_auc)),
            "test_sem_auc": _f(_sem(t_auc)),
            "control_sem_auc": _f(_sem(c_auc)),
            "delta_mean_ln_ic50": _f(d_ln),
            "ic50_fold_change": _f(math.exp(d_ln)),  # test / control potency ratio
            "delta_mean_auc": _f(np.mean(t_auc) - np.mean(c_auc)),
            "more_potent": "test" if d_ln < 0 else "control",
            "ln_ic50_test_vs_control": _welch_and_mwu(t_ln, c_ln),
            "auc_test_vs_control": _welch_and_mwu(t_auc, c_auc),
        }
        per_type.append(row)

    # pooled comparison over the focus tumour types
    if codes:
        tp = test[test["TCGA_DESC"].isin(codes)]
        cp = ctrl[ctrl["TCGA_DESC"].isin(codes)]
    else:
        tp, cp = test, ctrl

    def _mean(arr, fn=np.mean):
        arr = arr[np.isfinite(arr)]
        if arr.size == 0:
            return None
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return _f(fn(arr))

    tln = tp["LN_IC50"].to_numpy(dtype=float)
    cln = cp["LN_IC50"].to_numpy(dtype=float)
    pooled = {
        "scope": "所选肿瘤类型" if codes else "全部共有肿瘤类型",
        "ln_ic50": _welch_and_mwu(tln, cln),
        "auc": _welch_and_mwu(
            tp["AUC"].to_numpy(dtype=float), cp["AUC"].to_numpy(dtype=float)
        ),
        "test_geomean_ic50_um": _mean(tln, lambda a: math.exp(np.mean(a))),
        "control_geomean_ic50_um": _mean(cln, lambda a: math.exp(np.mean(a))),
        "test_mean_auc": _mean(tp["AUC"].to_numpy(dtype=float)),
        "control_mean_auc": _mean(cp["AUC"].to_numpy(dtype=float)),
    }

    return {
        "test_label": test_label,
        "control_label": control_label,
        "per_tumour_type": per_type,
        "pooled": pooled,
    }
