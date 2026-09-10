import { useMemo } from 'react';
import Autocomplete from './Autocomplete.jsx';
import UploadPanel from './UploadPanel.jsx';
import { searchDrugs } from '../api.js';

// Unified left panel. Renders the data-source switch, the mode switch, and then
// the inputs for the active mode ("analyze" or "screen").
export default function Sidebar({
  meta,
  metaLoading,
  dataSource,
  onDataSource,
  session,
  onUploaded,
  onClearUpload,
  mode,
  onMode,
  form,
  setForm,
  screenForm,
  setScreenForm,
  onRun,
  onReset,
  loading,
}) {
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setS = (patch) => setScreenForm((f) => ({ ...f, ...patch }));
  const sessionId = dataSource === 'upload' ? session?.session_id : null;

  const targetOptions = useMemo(() => (meta ? meta.targets.map((t) => t.name) : []), [meta]);
  const tumourTypes = meta ? meta.tumour_types : [];
  const drugFetcher = (q) => searchDrugs(q, null, 20, sessionId).then((r) => r.results);

  const uploadReady = dataSource === 'builtin' || !!session;
  const canRunAnalyze =
    uploadReady && !!(form.drug || form.target || form.pathway) && !loading;
  const canRunScreen =
    uploadReady && screenForm.tumour_types.length > 0 && screenForm.threshold !== '' && !loading;
  const canRun = mode === 'screen' ? canRunScreen : canRunAnalyze;

  function TumourChecklist({ selected, onToggle, onClear }) {
    return (
      <>
        <div
          style={{
            maxHeight: 190,
            overflowY: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 8,
          }}
        >
          {tumourTypes.length === 0 && <span className="footnote">无肿瘤类型</span>}
          {tumourTypes.map((t) => (
            <label key={t.code} className="check-row">
              <input
                type="checkbox"
                checked={selected.includes(t.code)}
                onChange={() => onToggle(t.code)}
              />
              <span style={{ color: 'var(--text-primary)' }}>{t.code}</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {t.label} · n={t.n_cell_lines}
              </span>
            </label>
          ))}
        </div>
        {selected.length > 0 && (
          <button
            className="btn secondary"
            style={{ marginTop: 6, padding: '4px 10px', fontSize: 12 }}
            onClick={onClear}
          >
            清除选择（{selected.length}）
          </button>
        )}
      </>
    );
  }

  return (
    <aside className="sidebar">
      <h1 className="brand">GDSC 药敏分析</h1>
      <p className="brand-sub">抗癌药物在 TCGA 肿瘤来源细胞系中的 IC50 / AUC 敏感性对比与阈值筛选</p>

      {/* data source */}
      <div className="field">
        <label>数据来源 Data source</label>
        <div className="metric-toggle">
          <button
            className={dataSource === 'builtin' ? 'active' : ''}
            onClick={() => onDataSource('builtin')}
          >
            内置 GDSC
          </button>
          <button
            className={dataSource === 'upload' ? 'active' : ''}
            onClick={() => onDataSource('upload')}
          >
            上传子集
          </button>
        </div>
      </div>

      {dataSource === 'upload' && (
        <UploadPanel session={session} onUploaded={onUploaded} onCleared={onClearUpload} />
      )}

      {dataSource === 'builtin' && (
        <div className="field">
          <label>数据集 Dataset</label>
          <select value={form.dataset} onChange={(e) => set({ dataset: e.target.value })}>
            {(meta?.datasets || ['GDSC2', 'GDSC1']).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* mode */}
      <div className="field">
        <label>功能 Mode</label>
        <div className="metric-toggle">
          <button className={mode === 'analyze' ? 'active' : ''} onClick={() => onMode('analyze')}>
            药敏分析
          </button>
          <button className={mode === 'screen' ? 'active' : ''} onClick={() => onMode('screen')}>
            阈值筛选
          </button>
        </div>
      </div>

      {metaLoading && <p className="footnote">正在加载目录…</p>}

      {mode === 'analyze' && meta && (
        <>
          <div className="field">
            <label>
              待测药物 Test drug <span className="hint">（可留空，用靶点/通路）</span>
            </label>
            <Autocomplete
              value={form.drug}
              onChange={(v) => set({ drug: v })}
              fetcher={drugFetcher}
              placeholder="例如 Trametinib"
              toValue={(d) => d.name}
              render={(d) => (
                <div>
                  {d.name} <small>· {d.datasets.join('/')} · {d.targets.slice(0, 3).join(', ')}</small>
                </div>
              )}
            />
          </div>

          <div className="field">
            <label>靶点 Target</label>
            <input
              list="target-list"
              type="text"
              value={form.target}
              placeholder="例如 EGFR / MEK1"
              onChange={(e) => set({ target: e.target.value })}
            />
            <datalist id="target-list">
              {targetOptions.slice(0, 1500).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          <div className="field">
            <label>信号通路 Pathway</label>
            <select value={form.pathway} onChange={(e) => set({ pathway: e.target.value })}>
              <option value="">（不限）</option>
              {(meta?.pathways || []).map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.n_drugs})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>
              对照药物 Control <span className="hint">（默认 Doxorubicin）</span>
            </label>
            <Autocomplete
              value={form.control_drug}
              onChange={(v) => set({ control_drug: v })}
              fetcher={drugFetcher}
              placeholder="Doxorubicin"
              toValue={(d) => d.name}
              render={(d) => (
                <div>
                  {d.name} <small>· {d.datasets.join('/')}</small>
                </div>
              )}
            />
          </div>

          <div className="field">
            <label>
              目标肿瘤类型 Tumour types{' '}
              <span className="hint">（{form.tumour_types.length ? `已选 ${form.tumour_types.length}` : '全部'}）</span>
            </label>
            <TumourChecklist
              selected={form.tumour_types}
              onToggle={(code) =>
                set({
                  tumour_types: form.tumour_types.includes(code)
                    ? form.tumour_types.filter((c) => c !== code)
                    : [...form.tumour_types, code],
                })
              }
              onClear={() => set({ tumour_types: [] })}
            />
          </div>

          <div className="field">
            <label>敏感性指标 Metric</label>
            <div className="metric-toggle">
              <button
                className={form.sensitivity_metric === 'AUC' ? 'active' : ''}
                onClick={() => set({ sensitivity_metric: 'AUC' })}
              >
                AUC
              </button>
              <button
                className={form.sensitivity_metric === 'LN_IC50' ? 'active' : ''}
                onClick={() => set({ sensitivity_metric: 'LN_IC50' })}
              >
                ln(IC50)
              </button>
            </div>
          </div>

          <div className="field">
            <label>每癌种最少细胞系数：{form.min_cell_lines}</label>
            <input
              type="range"
              min="1"
              max="20"
              value={form.min_cell_lines}
              style={{ width: '100%' }}
              onChange={(e) => set({ min_cell_lines: Number(e.target.value) })}
            />
          </div>
        </>
      )}

      {mode === 'screen' && meta && (
        <>
          <div className="field">
            <label>
              目标肿瘤类型 Tumour types <span className="hint">（必选，≥1）</span>
            </label>
            <TumourChecklist
              selected={screenForm.tumour_types}
              onToggle={(code) =>
                setS({
                  tumour_types: screenForm.tumour_types.includes(code)
                    ? screenForm.tumour_types.filter((c) => c !== code)
                    : [...screenForm.tumour_types, code],
                })
              }
              onClear={() => setS({ tumour_types: [] })}
            />
          </div>

          <div className="field">
            <label>筛选维度 Group by</label>
            <div className="metric-toggle">
              {['drug', 'target', 'pathway'].map((g) => (
                <button key={g} className={screenForm.group_by === g ? 'active' : ''} onClick={() => setS({ group_by: g })}>
                  {{ drug: '药物', target: '靶点', pathway: '通路' }[g]}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>基准指标 Metric</label>
            <select
              value={screenForm.metric}
              onChange={(e) => {
                const m = e.target.value;
                setS({ metric: m, threshold: DEFAULT_THRESHOLD[m] });
              }}
            >
              <option value="AUC">均值 AUC</option>
              <option value="IC50_UM">几何均值 IC50 (µM)</option>
              <option value="LN_IC50">均值 ln(IC50)</option>
            </select>
          </div>

          <div className="field">
            <label>
              敏感性阈值 Threshold{' '}
              <span className="hint">
                {screenForm.direction === 'below' ? '（优于 = 小于）' : '（优于 = 大于）'}
              </span>
            </label>
            <input
              type="number"
              step="0.01"
              value={screenForm.threshold}
              onChange={(e) => setS({ threshold: e.target.value })}
            />
            <div className="metric-toggle" style={{ marginTop: 6 }}>
              <button
                className={screenForm.direction === 'below' ? 'active' : ''}
                onClick={() => setS({ direction: 'below' })}
              >
                低于阈值（更敏感）
              </button>
              <button
                className={screenForm.direction === 'above' ? 'active' : ''}
                onClick={() => setS({ direction: 'above' })}
              >
                高于阈值
              </button>
            </div>
          </div>

          <div className="field">
            <label>聚合方式 Aggregate</label>
            <div className="metric-toggle">
              <button
                className={screenForm.aggregate === 'pooled' ? 'active' : ''}
                onClick={() => setS({ aggregate: 'pooled' })}
              >
                全部细胞系均值
              </button>
              <button
                className={screenForm.aggregate === 'per_type_mean' ? 'active' : ''}
                onClick={() => setS({ aggregate: 'per_type_mean' })}
              >
                癌种均值再平均
              </button>
            </div>
          </div>

          <div className="field">
            <label>最少细胞系数：{screenForm.min_cell_lines}</label>
            <input
              type="range"
              min="1"
              max="30"
              value={screenForm.min_cell_lines}
              style={{ width: '100%' }}
              onChange={(e) => setS({ min_cell_lines: Number(e.target.value) })}
            />
          </div>
        </>
      )}

      <button className="btn block" disabled={!canRun} onClick={onRun}>
        {loading ? '计算中…' : mode === 'screen' ? '运行筛选' : '运行分析'}
      </button>
      <button className="btn secondary block" style={{ marginTop: 8 }} onClick={onReset} disabled={loading}>
        重置
      </button>
    </aside>
  );
}

export const DEFAULT_THRESHOLD = { AUC: 0.8, IC50_UM: 1, LN_IC50: 0 };
