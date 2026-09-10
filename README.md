# GDSC2 药物抗癌敏感性分析网页工具

基于 **GDSC**（Genomics of Drug Sensitivity in Cancer）*fitted dose-response* 批量下载数据，
分析不同抗癌药物 / 靶点 / 信号通路在各 **TCGA 肿瘤来源癌细胞系**中的杀伤效力
（IC50 / AUC 敏感性）差异，并支持与标准对照药（默认 **Doxorubicin**）做药效对比。

前后端分离：**FastAPI** 负责 Excel 解析 + 统计计算，**React** 负责交互与图表渲染，
接口 JSON 交互。可视化以**带误差棒的箱线图**与**统计对比图**为主，不使用 AI 生成图片；
筛选逻辑基于**均值敏感性对比**，不做机器学习、预后或基因突变关联分析。

---

## 1. 快速开始

```bash
# 1) 下载数据（约 50 MB，见 data/README.md）
cd data
curl -O https://cog.sanger.ac.uk/cancerrxgene/GDSC_release8.5/GDSC2_fitted_dose_response_27Oct23.xlsx
curl -O https://cog.sanger.ac.uk/cancerrxgene/GDSC_release8.5/GDSC1_fitted_dose_response_27Oct23.xlsx
curl -O https://cog.sanger.ac.uk/cancerrxgene/GDSC_release8.5/Cell_Lines_Details.xlsx
cd ..

# 2) 一键启动（首次会自动建 venv 并 npm install）
./start.sh
```

- 前端：http://127.0.0.1:5273
- 后端 API 文档（Swagger）：http://127.0.0.1:8000/docs

也可以分别启动：

```bash
# 后端
cd backend && ./run.sh                 # http://127.0.0.1:8000

# 前端（另一个终端）
cd frontend && npm install && npm run dev   # http://127.0.0.1:5273
```

首次启动后端会解析两个 xlsx（约 40 秒）并写入 `data/gdsc_combined.parquet` 缓存；
之后启动为秒级。删除该 parquet 可强制重新解析。

---

## 2. 使用方式

左侧面板顶部有两个开关：

- **数据来源**：`内置 GDSC`（bundled 数据）/ `上传子集`（见 §6）。
- **功能**：`药敏分析` / `阈值筛选`。

### 2.1 药敏分析模式

| 输入项 | 说明 |
|--------|------|
| **数据集 Dataset** | `GDSC2`（默认）或 `GDSC1`（仅内置数据） |
| **待测药物 Test drug** | 药物名，自动补全；可留空，改用靶点或通路选择 |
| **靶点 Target** | 如 `EGFR`、`MEK1`；对 `PUTATIVE_TARGET` 做子串匹配 |
| **信号通路 Pathway** | 24 条 GDSC 通路，如 `PI3K/MTOR signaling` |
| **对照药物 Control** | 默认 `Doxorubicin`；可替换为任意药物 |
| **目标肿瘤类型 Tumour types** | 勾选一个或多个 TCGA 类型；不选 = 全部 |
| **敏感性指标 Metric** | 排序 / 展示用 `AUC` 或 `ln(IC50)` |
| **每癌种最少细胞系数** | 低于该阈值的癌种不计入统计与排序（默认 3） |

点击**运行分析**后，右侧输出：概览（最敏感 / 最不敏感肿瘤类型、pooled IC50 与检验 p 值）→
① 药物-肿瘤敏感性排序（水平条形图 + SEM 误差棒 + ANOVA / Kruskal-Wallis）→
② 药敏箱线图（每癌种多细胞系分布 + 均值 ± SEM 误差棒）→
③ 标准药物对照（分组柱状对比图 + 明细表：IC50 倍数、ΔAUC、Welch t、Mann-Whitney U）→
④ 统计结果表（平均 IC50 / AUC、中位数、SD、SEM、Z-score、敏感性排名，可排序）。

### 2.2 阈值筛选模式（自定义药敏基准）

| 输入项 | 说明 |
|--------|------|
| **目标肿瘤类型** | 必选，≥1 个 TCGA 类型 |
| **筛选维度 Group by** | `药物` / `靶点` / `通路` |
| **基准指标 Metric** | `均值 AUC` / `几何均值 IC50 (µM)` / `均值 ln(IC50)` |
| **敏感性阈值 Threshold** | 自定义数值；方向可选「低于阈值（更敏感）」或「高于阈值」 |
| **聚合方式 Aggregate** | `全部细胞系均值`（pooled）或 `癌种均值再平均` |
| **最少细胞系数** | 每个分组需达到的细胞系数门槛 |

系统列出在所选癌种中平均敏感性**优于阈值**的药物 / 靶点 / 通路：命中排序图
（达标项绿色、阈值虚线、SEM 误差棒）+ 命中明细表（可切换「仅看命中 / 看全部」）+ CSV 导出。

**导出**：每个图表右上角 `⬇ PNG`；每个表格下方 `⬇ 导出 CSV（后端）` 与 `⬇ 导出当前表格`。

---

## 3. 计算口径

- **IC50 (µM)** = `exp(LN_IC50)`。癌种层面报告**几何均值**（`exp(mean(LN_IC50))`）与中位数，
  避免长尾影响。
- **AUC**：剂量-反应曲线下面积，0–1，**越小越敏感**。
- **误差棒**：均值 ± **SEM**（`SD / sqrt(n)`），n 为该癌种细胞系数。
- **敏感性排名**：默认按平均 AUC 升序（越敏感排名越靠前），可切换为 `ln(IC50)`。
- **跨肿瘤类型差异**：单因素 **ANOVA**（`scipy.stats.f_oneway`）+ 非参数
  **Kruskal-Wallis**，仅纳入细胞系数 ≥ 阈值的癌种。
- **待测 vs 对照**（每个肿瘤类型 & pooled）：**Welch t-test**（不等方差）+
  **Mann-Whitney U**；`ic50_fold_change = exp(mean_ln_ic50_test − mean_ln_ic50_control)`，
  <1 表示待测药更强效。
- 同一 `(dataset, drug, cell line)` 的重复筛选记录（约 32 个药物）先按均值合并，
  保证每个细胞系对统计只贡献一次。

> **关于 Doxorubicin**：GDSC2 不含该药，仅 GDSC1 有。当对照药在所选数据集中缺失时，
> 后端自动回退到其它数据集查找，并以 `cross_dataset` 标记；前端在对照卡片顶部给出
> 醒目提示，此时对比仅作趋势参考。GDSC2 内可用 **Epirubicin**（同为蒽环类）作同数据集对照。

---

## 4. API

Base URL `http://127.0.0.1:8000`

| 方法 & 路径 | 说明 |
|-------------|------|
| `GET /api/health` | 存活检查 + 数据集规模 + 当前内存中的上传会话数 |
| `GET /api/meta?session_id=` | 目录：datasets / drugs / targets / pathways / tumour_types（带 `session_id` 则返回该上传数据的目录） |
| `GET /api/drugs?q=&dataset=&session_id=&limit=` | 药物自动补全 |
| `POST /api/analyze` | 药敏分析，返回统计 + 对比 + 绘图点 + `plot_guidance` |
| `POST /api/screen` | 阈值筛选，返回命中的药物 / 靶点 / 通路 |
| `POST /api/upload` (multipart) | 校验并把上传文件存入**内存会话**，返回清洗报告 + 目录 |
| `DELETE /api/session/{id}` · `POST /api/session/{id}/drop` | 立即销毁上传会话（后者供 `navigator.sendBeacon`） |
| `POST /api/export/tumour-stats.csv` · `comparison.csv` · `screen.csv` | 结果 CSV（带 UTF-8 BOM） |

所有 `analyze` / `screen` / `export` 请求体都带 `source`（`"builtin"` 或 `"upload"`）与
`session_id`（`source="upload"` 时必填）。`POST /api/analyze` 主要字段：

```jsonc
{
  "source": "builtin",           // 或 "upload"
  "session_id": null,            // source="upload" 时为 /api/upload 返回的 id
  "dataset": "GDSC2",            // 内置数据用；upload 时忽略
  "drug": "Trametinib",          // 或留空，用 target / pathway
  "target": null, "pathway": null,
  "control_drug": "Doxorubicin", // 可为 null
  "tumour_types": ["SKCM", "COREAD"],  // 空数组 = 全部
  "min_cell_lines": 3,
  "sensitivity_metric": "AUC"     // 或 "LN_IC50"
}
```

`POST /api/screen` 主要字段：

```jsonc
{
  "source": "builtin", "session_id": null, "dataset": "GDSC2",
  "tumour_types": ["SKCM", "COREAD"],   // 必填，≥1
  "group_by": "drug",                   // drug | target | pathway
  "metric": "AUC",                      // AUC | IC50_UM | LN_IC50
  "threshold": 0.8,
  "direction": "below",                 // below = 更敏感
  "aggregate": "pooled",                // 或 per_type_mean
  "min_cell_lines": 3
}
```

---

## 5. 文件上传 · 校验 · 数据安全

**上传自己的 GDSC 子集**（`.xlsx` / `.xls` / `.csv`，≤40 MB）。后端校验流程：

1. **文件格式**：扩展名 + 能否解析为数据表；多 sheet 时自动挑选最像剂量-反应表的 sheet。
2. **必填字段**：药物名 · 细胞系标识 · 肿瘤类型 · `AUC` · `LN_IC50`（或 `IC50`）。
   列名大小写 / 空格 / 常见别名（`Drug Name`、`Cancer Type`、`ln IC50` 等）自动映射；
   缺列时前端明确列出「缺哪些字段」和「文件里有哪些列」。
3. **空值 / 异常极值过滤**（逐条计数并在清洗报告中展示）：
   - 必填字段为空 → 丢弃；
   - `AUC ∉ [0, 1]` → 丢弃，其余 clip 到 `[0,1]`；
   - `IC50 ≤ 0`、非有限值、`|ln(IC50)| > 50` → 丢弃；
   - 同一 `(dataset, drug, cell line)` 重复记录 → 取均值合并。
4. 清洗后无有效行、无匹配药物 / 癌种时，返回**中文友好报错**，前端不崩溃、不显示空白图表。

**数据安全（不缓存 / 不持久化）**：

- 上传数据仅存在于后端进程内存（`upload_store`），**永不写盘、永不进 parquet 缓存**；
  原始上传字节读取后立即释放。
- 会话以不可猜测的随机 id（`secrets.token_urlsafe`）标识；30 分钟无操作自动过期；
  全局并发上限 16 个，超出按最旧淘汰；进程退出全部清空。
- 前端 **不使用 localStorage / sessionStorage 保存 session id**——刷新页面即丢失，
  并在 `pagehide` / `beforeunload` 通过 `sendBeacon` 通知后端销毁；也可手动「清除上传数据」。
- 所有 `/api/*` 响应带 `Cache-Control: no-store`。

## 6. 全场景健壮性

- 适配任意大小的 GDSC 子集：少量数据、单癌种、单药物均可正常渲染。
- 样本量不足以画箱线图的癌种：后端 `plot_guidance` 标注，前端自动屏蔽该类别并给出提示；
  全部癌种都不足时隐藏箱线图、保留统计表。
- 无癌种达到细胞系门槛时，敏感性排序图替换为提示而非空图。
- 跨癌种差异检验要求每组 ≥2 细胞系且 ≥2 组，否则给出说明性提示。
- 每个可视化 / 表格模块包裹 React ErrorBoundary，单模块出错不影响其余页面。
- 后端统一异常处理：任何错误都返回 JSON `{detail}`，绝不返回空白 500。

---

## 7. 目录结构

```
.
├── data/                    # GDSC xlsx + parquet 缓存（.gitignore；上传数据永不落此）
│   └── README.md
├── backend/
│   ├── app/
│   │   ├── config.py        # 路径、默认值、阈值、TCGA 代码→名称
│   │   ├── validation.py    # 文件解析、列名映射、必填字段与异常值校验（内置+上传共用）
│   │   ├── data_store.py    # 内置 xlsx 加载 + parquet 缓存 + 目录构建
│   │   ├── upload_store.py  # 上传数据的内存会话（TTL / 容量 / 销毁）
│   │   ├── analysis.py      # 药敏统计与对照对比
│   │   ├── screening.py     # 阈值筛选
│   │   ├── schemas.py       # Pydantic 请求模型
│   │   └── main.py          # FastAPI 路由、异常处理、no-store、CSV 导出
│   ├── requirements.txt
│   └── run.sh
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api.js           # JSON 客户端 + 上传 + CSV 下载 + sendBeacon 清理
│   │   ├── plot.js          # Plotly 主题/配置
│   │   └── components/      # Sidebar / UploadPanel / ScreenResults / *Chart / *Table
│   │       │                #   / ErrorBoundary / Notice / Autocomplete
│   ├── vite.config.js       # /api 代理到 :8000（端口 5273）
│   └── package.json
├── start.sh                 # 同时启动前后端
└── README.md
```

## 8. 技术栈

- 后端：FastAPI · pandas · numpy · scipy · openpyxl · pyarrow · python-multipart
- 前端：React 18 · Vite 6 · Plotly.js（箱线图 / 误差棒 / 分组柱状图 / PNG 导出）

## 9. 数据引用

Yang W, *et al.* **Genomics of Drug Sensitivity in Cancer (GDSC): a resource for
therapeutic biomarker discovery in cancer cells.** *Nucleic Acids Res.* 2013.
数据版本：GDSC release 8.5（fitted dose-response，27Oct23）。
