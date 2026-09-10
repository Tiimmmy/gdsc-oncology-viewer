import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getMeta,
  analyze,
  screen as screenApi,
  downloadCsv,
  exportRowsAsCsv,
  deleteSession,
  dropSessionBeacon,
} from './api.js';
import Sidebar, { DEFAULT_THRESHOLD } from './components/Sidebar.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Notice from './components/Notice.jsx';
import StatsTable from './components/StatsTable.jsx';
import ComparisonTable from './components/ComparisonTable.jsx';
import SensitivityBoxplot from './components/SensitivityBoxplot.jsx';
import ComparisonChart from './components/ComparisonChart.jsx';
import DistributionChart from './components/DistributionChart.jsx';
import ScreenResults from './components/ScreenResults.jsx';

const DEFAULT_FORM = {
  dataset: 'GDSC2',
  drug: 'Trametinib',
  target: '',
  pathway: '',
  control_drug: 'Doxorubicin',
  tumour_types: [],
  min_cell_lines: 3,
  sensitivity_metric: 'AUC',
};

const DEFAULT_SCREEN = {
  tumour_types: [],
  group_by: 'drug',
  metric: 'AUC',
  threshold: DEFAULT_THRESHOLD.AUC,
  direction: 'below',
  aggregate: 'pooled',
  min_cell_lines: 3,
};

const fmt = (v, d = 3) =>
  v === null || v === undefined || Number.isNaN(v)
    ? '–'
    : Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)
    ? v.toExponential(2)
    : Number(v).toFixed(d);

const pfmt = (p) =>
  p === null || p === undefined ? '–' : p < 0.001 ? p.toExponential(1) : p.toFixed(3);

function friendlyError(msg) {
  if (!msg) return '发生未知错误。';
  if (/Failed to fetch|NetworkError|ERR_CONNECTION/i.test(msg))
    return '无法连接后端服务（http://127.0.0.1:8000）。请确认后端已启动。';
  return msg;
}

function analyzePayload(form, dataSource, session) {
  return {
    source: dataSource,
    session_id: dataSource === 'upload' ? session?.session_id : null,
    dataset: dataSource === 'builtin' ? form.dataset : null,
    drug: form.drug || null,
    target: form.target || null,
    pathway: form.pathway || null,
    control_drug: form.control_drug || null,
    tumour_types: form.tumour_types,
    min_cell_lines: form.min_cell_lines,
    sensitivity_metric: form.sensitivity_metric,
    include_points: true,
  };
}

function screenPayload(sf, form, dataSource, session) {
  return {
    source: dataSource,
    session_id: dataSource === 'upload' ? session?.session_id : null,
    dataset: dataSource === 'builtin' ? form.dataset : null,
    tumour_types: sf.tumour_types,
    group_by: sf.group_by,
    metric: sf.metric,
    threshold: Number(sf.threshold),
    direction: sf.direction,
    aggregate: sf.aggregate,
    min_cell_lines: sf.min_cell_lines,
    limit: 400,
  };
}

export default function App() {
  const [dataSource, setDataSource] = useState('builtin');
  const [session, setSession] = useState(null);
  const [mode, setMode] = useState('analyze');

  const [builtinMeta, setBuiltinMeta] = useState(null);
  const [uploadMeta, setUploadMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const [form, setForm] = useState(DEFAULT_FORM);
  const [screenForm, setScreenForm] = useState(DEFAULT_SCREEN);

  const [result, setResult] = useState(null);
  const [screenResult, setScreenResult] = useState(null);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [chartMetric, setChartMetric] = useState('AUC');

  const meta = dataSource === 'upload' ? uploadMeta : builtinMeta;
  const downloadFns = useRef({});
  const registerDownload = (key) => (fn) => {
    downloadFns.current[key] = fn;
  };

  // built-in catalog once
  useEffect(() => {
    getMeta()
      .then((m) => setBuiltinMeta(m))
      .catch((e) => setMetaError(friendlyError(e.message)))
      .finally(() => setMetaLoading(false));
  }, []);

  // clean up the in-memory upload session when the tab closes / reloads
  useEffect(() => {
    const handler = () => dropSessionBeacon(session?.session_id);
    window.addEventListener('pagehide', handler);
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('pagehide', handler);
      window.removeEventListener('beforeunload', handler);
    };
  }, [session]);

  const clearResults = () => {
    setResult(null);
    setScreenResult(null);
    setError(null);
  };

  function onDataSource(next) {
    if (next === dataSource) return;
    setDataSource(next);
    clearResults();
    setMetaError(null);
  }

  function onUploaded(res) {
    setSession(res);
    setUploadMeta(res.meta);
    clearResults();
    // uploaded subsets rarely contain Doxorubicin / GDSC2 defaults
    setForm((f) => ({ ...f, drug: '', target: '', pathway: '', control_drug: '', tumour_types: [] }));
    setScreenForm((s) => ({ ...s, tumour_types: [] }));
  }

  async function onClearUpload() {
    const sid = session?.session_id;
    setSession(null);
    setUploadMeta(null);
    clearResults();
    await deleteSession(sid);
  }

  const runAnalyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    const p = analyzePayload(form, dataSource, session);
    try {
      const r = await analyze(p);
      setResult(r);
      setScreenResult(null);
      setPayload(p);
      setChartMetric(form.sensitivity_metric === 'LN_IC50' ? 'LN_IC50' : 'AUC');
    } catch (e) {
      setError(friendlyError(e.message));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [form, dataSource, session]);

  const runScreen = useCallback(async () => {
    setLoading(true);
    setError(null);
    const p = screenPayload(screenForm, form, dataSource, session);
    try {
      const r = await screenApi(p);
      setScreenResult(r);
      setResult(null);
      setPayload(p);
    } catch (e) {
      setError(friendlyError(e.message));
      setScreenResult(null);
    } finally {
      setLoading(false);
    }
  }, [screenForm, form, dataSource, session]);

  function reset() {
    setForm(DEFAULT_FORM);
    setScreenForm(DEFAULT_SCREEN);
    clearResults();
  }

  function exportStats(kind) {
    if (!result) return;
    if (kind === 'csv') {
      downloadCsv('/api/export/tumour-stats.csv', payload, `tumour_stats_${result.selection.label}.csv`).catch(
        (e) => setError(friendlyError(e.message)),
      );
    } else {
      exportRowsAsCsv(result.tumour_stats, `tumour_stats_${result.selection.label}_client.csv`);
    }
  }

  const gtests = result?.group_difference_tests;
  const guidance = result?.plot_guidance || {};

  return (
    <div className="app-shell">
      <Sidebar
        meta={meta}
        metaLoading={metaLoading && dataSource === 'builtin'}
        dataSource={dataSource}
        onDataSource={onDataSource}
        session={session}
        onUploaded={onUploaded}
        onClearUpload={onClearUpload}
        mode={mode}
        onMode={(m) => {
          setMode(m);
          clearResults();
        }}
        form={form}
        setForm={setForm}
        screenForm={screenForm}
        setScreenForm={setScreenForm}
        onRun={mode === 'screen' ? runScreen : runAnalyze}
        onReset={reset}
        loading={loading}
      />

      <main className="main">
        {metaError && (
          <div className="error-box">
            {metaError}
            <br />
            请先运行 <code>./start.sh</code> 或 <code>backend/run.sh</code> 启动后端。
          </div>
        )}

        {dataSource === 'upload' && !session && !metaError && (
          <Intro upload />
        )}
        {dataSource === 'builtin' && !meta && !metaError && (
          <div className="loading">正在加载数据集目录…</div>
        )}
        {meta && !result && !screenResult && !loading && !error && <Intro meta={meta} mode={mode} />}

        {result?.warnings?.length > 0 && (
          <Notice kind="warn" title="提示">
            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Notice>
        )}

        {error && <div className="error-box">分析失败：{error}</div>}
        {loading && <div className="loading">正在计算…</div>}

        {/* ---------------- SCREEN MODE ---------------- */}
        {screenResult && (
          <ErrorBoundary>
            <ScreenResults result={screenResult} payload={payload} />
          </ErrorBoundary>
        )}

        {/* ---------------- ANALYZE MODE ---------------- */}
        {result && (
          <ErrorBoundary>
            <SummaryCard result={result} chartMetric={chartMetric} setChartMetric={setChartMetric} />

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>1 · 药物-肿瘤敏感性排序</h2>
                  <p className="card-sub">
                    {result.selection.label} 在各 TCGA 肿瘤类型的
                    {chartMetric === 'AUC' ? '平均 AUC' : '几何均值 IC50'}（越低越敏感）。
                    蓝色为当前所选肿瘤类型。
                  </p>
                </div>
                {guidance.can_distribution && (
                  <button className="btn secondary" onClick={() => downloadFns.current.dist?.()}>
                    ⬇ PNG
                  </button>
                )}
              </div>
              <ErrorBoundary>
                <DistributionChart
                  result={result}
                  metric={chartMetric}
                  onDownload={registerDownload('dist')}
                />
              </ErrorBoundary>
              {gtests?.anova_auc ? (
                <p className="footnote">
                  跨肿瘤类型差异检验（n={gtests.n_groups} 组）：ANOVA(AUC) F=
                  {fmt(gtests.anova_auc.F, 2)}, p={pfmt(gtests.anova_auc.p)}；ANOVA(lnIC50) F=
                  {fmt(gtests.anova_ln_ic50.F, 2)}, p={pfmt(gtests.anova_ln_ic50.p)}；Kruskal-Wallis(AUC) p=
                  {pfmt(gtests.kruskal_auc.p)}。
                </p>
              ) : (
                gtests?.note && <p className="footnote">{gtests.note}</p>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>2 · 药敏箱线图（含误差棒）</h2>
                  <p className="card-sub">
                    每个肿瘤类型多细胞系的{chartMetric === 'AUC' ? ' AUC ' : ' ln(IC50) '}分布；
                    橙色菱形为均值 ± SEM。
                  </p>
                </div>
                {guidance.can_boxplot && (
                  <button className="btn secondary" onClick={() => downloadFns.current.box?.()}>
                    ⬇ PNG
                  </button>
                )}
              </div>
              <ErrorBoundary>
                <SensitivityBoxplot
                  result={result}
                  metric={chartMetric}
                  onDownload={registerDownload('box')}
                />
              </ErrorBoundary>
            </section>

            {result.comparison ? (
              <section className="card">
                <div className="card-head">
                  <div>
                    <h2>
                      3 · 标准药物对照：{result.comparison.test_label} vs {result.comparison.control_label}
                    </h2>
                    <p className="card-sub">
                      {result.control?.cross_dataset && (
                        <strong style={{ color: 'var(--danger)' }}>
                          注意：对照药来自 {result.control.dataset}，与待测数据集不同，仅作趋势参考。{' '}
                        </strong>
                      )}
                      同一肿瘤类型下两药的
                      {chartMetric === 'AUC' ? '平均 AUC' : '几何均值 IC50'}对比，误差棒为 SEM。
                    </p>
                  </div>
                  {guidance.can_comparison && (
                    <button className="btn secondary" onClick={() => downloadFns.current.cmp?.()}>
                      ⬇ PNG
                    </button>
                  )}
                </div>
                <PooledCompare pooled={result.comparison.pooled} comparison={result.comparison} />
                <ErrorBoundary>
                  <ComparisonChart
                    comparison={result.comparison}
                    metric={chartMetric}
                    onDownload={registerDownload('cmp')}
                  />
                </ErrorBoundary>
                <div style={{ marginTop: 16 }}>
                  <ErrorBoundary>
                    <ComparisonTable comparison={result.comparison} payload={payload} />
                  </ErrorBoundary>
                </div>
              </section>
            ) : (
              <section className="card">
                <h2>3 · 标准药物对照</h2>
                <Notice kind="empty">
                  {result.control?.error
                    ? result.control.error
                    : '未设置对照药物。可在左侧填写对照药后重新分析。'}
                </Notice>
              </section>
            )}

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>4 · 统计结果表</h2>
                  <p className="card-sub">
                    各癌种多细胞系平均 IC50 / AUC、离散度与敏感性排名。点击表头排序。
                  </p>
                </div>
              </div>
              <ErrorBoundary>
                <StatsTable rows={result.tumour_stats} onExport={exportStats} />
              </ErrorBoundary>
            </section>

            <p className="footnote">
              数据来源：GDSC fitted dose-response bulk download, release 8.5 (27Oct23)。IC50 单位 µM，
              由 exp(LN_IC50) 得到；AUC 为剂量-反应曲线下面积（0–1，越小越敏感）。
              所有筛选基于均值敏感性对比，不涉及机器学习、预后或基因突变关联分析。
            </p>
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}

function Intro({ meta, mode, upload }) {
  if (upload) {
    return (
      <section className="card">
        <h2>上传我的 GDSC 子集</h2>
        <p className="card-sub">
          在左侧选择 .xlsx / .xls / .csv 文件。系统会校验文件格式与必填字段
          （药物、细胞系、肿瘤类型、AUC、LN_IC50/IC50），过滤空值与非法极值后即可分析。
        </p>
        <Notice kind="info" title="数据安全">
          上传数据只存在于服务器内存，永不写入磁盘、永不缓存；关闭或刷新页面即自动清除，
          也可随时点击「清除上传数据」。
        </Notice>
      </section>
    );
  }
  if (!meta) return null;
  return (
    <section className="card">
      <h2>GDSC 药物抗癌敏感性分析工具</h2>
      <p className="card-sub">
        {mode === 'screen' ? (
          <>
            <strong>阈值筛选</strong>：选定肿瘤类型与敏感性基准（AUC / IC50 / lnIC50），
            系统自动列出在该癌种中平均敏感性优于阈值的药物、靶点或通路。
          </>
        ) : (
          <>
            <strong>药敏分析</strong>：选择待测药物 / 靶点 / 通路与目标肿瘤类型，
            分析对哪些 TCGA 肿瘤类型最敏感，并与对照药（默认 Doxorubicin）做 IC50 / AUC 对比。
          </>
        )}
      </p>
      <div className="summary-grid">
        <div className="stat-tile">
          <div className="k">药物 Drugs</div>
          <div className="v">{meta.counts.drugs}</div>
        </div>
        <div className="stat-tile">
          <div className="k">靶点 Targets</div>
          <div className="v">{meta.counts.targets}</div>
        </div>
        <div className="stat-tile">
          <div className="k">通路 Pathways</div>
          <div className="v">{meta.counts.pathways}</div>
        </div>
        <div className="stat-tile">
          <div className="k">TCGA 肿瘤类型</div>
          <div className="v">{meta.counts.tumour_types}</div>
        </div>
        {Object.entries(meta.summary)
          .filter(([k]) => k !== 'n_records')
          .map(([k, v]) => (
            <div className="stat-tile" key={k}>
              <div className="k">{k}</div>
              <div className="v">
                {v.n_records.toLocaleString()} <small>记录 · {v.n_drugs} 药 · {v.n_cell_lines} 细胞系</small>
              </div>
            </div>
          ))}
      </div>
      <p className="footnote">点击左侧「{mode === 'screen' ? '运行筛选' : '运行分析'}」开始。</p>
    </section>
  );
}

function SummaryCard({ result, chartMetric, setChartMetric }) {
  const s = result.selection;
  const ms = result.most_sensitive;
  const ls = result.least_sensitive;
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{s.label}</h2>
          <p className="card-sub">
            {s.dataset || '全部数据'} · {s.n_drugs} 个药物 · {s.n_records.toLocaleString()} 条记录 ·{' '}
            {s.n_cell_lines} 细胞系 · {s.n_tumour_types} 肿瘤类型
            {s.targets?.length ? ` · 靶点 ${s.targets.join(', ')}` : ''}
            {s.pathways?.length ? ` · 通路 ${s.pathways.join(', ')}` : ''}
          </p>
        </div>
        <div className="metric-toggle" style={{ minWidth: 160 }}>
          <button className={chartMetric === 'AUC' ? 'active' : ''} onClick={() => setChartMetric('AUC')}>
            按 AUC
          </button>
          <button
            className={chartMetric === 'LN_IC50' ? 'active' : ''}
            onClick={() => setChartMetric('LN_IC50')}
          >
            按 IC50
          </button>
        </div>
      </div>
      <div className="summary-grid">
        {ms ? (
          <div className="stat-tile">
            <div className="k">最敏感肿瘤类型</div>
            <div className="v">
              {ms.tcga_code}{' '}
              <small>
                AUC {fmt(ms.mean_auc)} · IC50 {fmt(ms.geomean_ic50_um)} µM · n={ms.n_cell_lines}
              </small>
            </div>
          </div>
        ) : (
          <div className="stat-tile">
            <div className="k">敏感性排序</div>
            <div className="v">
              <small>无癌种达到最少细胞系门槛</small>
            </div>
          </div>
        )}
        {ls && (
          <div className="stat-tile">
            <div className="k">最不敏感</div>
            <div className="v">
              {ls.tcga_code} <small>AUC {fmt(ls.mean_auc)} · IC50 {fmt(ls.geomean_ic50_um)} µM</small>
            </div>
          </div>
        )}
        {result.comparison && (
          <>
            <div className="stat-tile">
              <div className="k">
                pooled IC50 {result.comparison.test_label} / {result.comparison.control_label}
              </div>
              <div className="v">
                {fmt(result.comparison.pooled.test_geomean_ic50_um)} /{' '}
                {fmt(result.comparison.pooled.control_geomean_ic50_um)} µM
              </div>
            </div>
            <div className="stat-tile">
              <div className="k">pooled AUC 检验 (Welch)</div>
              <div className="v">p={pfmt(result.comparison.pooled.auc.welch_p)}</div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function PooledCompare({ pooled, comparison }) {
  return (
    <div className="summary-grid" style={{ marginBottom: 16 }}>
      <div className="stat-tile">
        <div className="k">{comparison.test_label} · 几何均值 IC50</div>
        <div className="v">{fmt(pooled.test_geomean_ic50_um)} µM</div>
      </div>
      <div className="stat-tile">
        <div className="k">{comparison.control_label} · 几何均值 IC50</div>
        <div className="v">{fmt(pooled.control_geomean_ic50_um)} µM</div>
      </div>
      <div className="stat-tile">
        <div className="k">ln(IC50) 差异 Welch t-test</div>
        <div className="v">
          p={pfmt(pooled.ln_ic50.welch_p)}{' '}
          <small>
            Δ={fmt(pooled.ln_ic50.mean_diff)} · MWU p={pfmt(pooled.ln_ic50.mannwhitney_p)}
          </small>
        </div>
      </div>
      <div className="stat-tile">
        <div className="k">AUC 差异 Welch t-test</div>
        <div className="v">
          p={pfmt(pooled.auc.welch_p)}{' '}
          <small>Δ={fmt(pooled.auc.mean_diff)} · MWU p={pfmt(pooled.auc.mannwhitney_p)}</small>
        </div>
      </div>
      <div className="stat-tile">
        <div className="k">对比范围</div>
        <div className="v">
          <small>{pooled.scope}</small>
        </div>
      </div>
    </div>
  );
}
