# 数据目录 / Data directory

本工具使用 **GDSC**（Genomics of Drug Sensitivity in Cancer）的 *fitted dose-response*
批量下载数据，release 8.5（27Oct23）。

下载页面：https://www.cancerrxgene.org/downloads/bulk_download

## 需要的文件

| 文件 | 说明 | 直链（Sanger COG 镜像） |
|------|------|------------------------|
| `GDSC2_fitted_dose_response_27Oct23.xlsx` | GDSC2 药敏拟合结果（主数据集） | https://cog.sanger.ac.uk/cancerrxgene/GDSC_release8.5/GDSC2_fitted_dose_response_27Oct23.xlsx |
| `GDSC1_fitted_dose_response_27Oct23.xlsx` | GDSC1 药敏拟合结果（含 Doxorubicin 等对照药） | https://cog.sanger.ac.uk/cancerrxgene/GDSC_release8.5/GDSC1_fitted_dose_response_27Oct23.xlsx |
| `Cell_Lines_Details.xlsx` | 细胞系注释（可选，当前分析未直接使用） | https://cog.sanger.ac.uk/cancerrxgene/GDSC_release8.5/Cell_Lines_Details.xlsx |

一键下载：

```bash
cd data
curl -O https://cog.sanger.ac.uk/cancerrxgene/GDSC_release8.5/GDSC2_fitted_dose_response_27Oct23.xlsx
curl -O https://cog.sanger.ac.uk/cancerrxgene/GDSC_release8.5/GDSC1_fitted_dose_response_27Oct23.xlsx
curl -O https://cog.sanger.ac.uk/cancerrxgene/GDSC_release8.5/Cell_Lines_Details.xlsx
```

## 关于对照药 Doxorubicin

GDSC2 数据集中**不含 Doxorubicin**，它只在 GDSC1 中（286 个 GDSC2 药物 vs 378 个 GDSC1 药物）。
后端会在对照药于当前数据集中缺失时自动回退到其它数据集查找，并在结果里以
`cross_dataset` 标记提示这是跨数据集对比（仅作趋势参考）。GDSC2 中与 Doxorubicin
最接近的蒽环类药物是 **Epirubicin**，可作为同数据集对照。

## 关键字段

`DATASET, COSMIC_ID, CELL_LINE_NAME, TCGA_DESC, DRUG_NAME, PUTATIVE_TARGET,
PATHWAY_NAME, LN_IC50, AUC, Z_SCORE`

- `LN_IC50`：IC50 的自然对数（µM）。后端计算 `IC50_UM = exp(LN_IC50)`。
- `AUC`：剂量-反应曲线下面积，范围 0–1，**越小越敏感**。
- `TCGA_DESC`：TCGA 肿瘤类型缩写（如 `SKCM`、`COREAD`、`LUAD`）。

生成的 `gdsc_combined.parquet` 是解析后的缓存，删除后下次启动会重新生成。
