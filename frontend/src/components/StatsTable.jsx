import { useMemo, useState } from 'react';

const fmt = (v, d = 3) =>
  v === null || v === undefined || Number.isNaN(v)
    ? '–'
    : Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)
    ? v.toExponential(2)
    : Number(v).toFixed(d);

const COLUMNS = [
  { key: 'sensitivity_rank', label: '排名', d: 0 },
  { key: 'tcga_code', label: 'TCGA', text: true },
  { key: 'tcga_label', label: '肿瘤类型', text: true, wide: true },
  { key: 'n_cell_lines', label: '细胞系数', d: 0 },
  { key: 'geomean_ic50_um', label: '几何均值 IC50 (µM)' },
  { key: 'median_ic50_um', label: '中位 IC50 (µM)' },
  { key: 'mean_ln_ic50', label: '均值 ln(IC50)' },
  { key: 'sem_ln_ic50', label: 'SEM ln(IC50)' },
  { key: 'mean_auc', label: '均值 AUC' },
  { key: 'sd_auc', label: 'SD AUC' },
  { key: 'sem_auc', label: 'SEM AUC' },
  { key: 'mean_zscore', label: '均值 Z-score' },
];

export default function StatsTable({ rows, onExport }) {
  const [sortKey, setSortKey] = useState('sensitivity_rank');
  const [asc, setAsc] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      return asc ? av - bv : bv - av;
    });
    return copy;
  }, [rows, sortKey, asc]);

  function clickHead(key) {
    if (key === sortKey) setAsc((x) => !x);
    else {
      setSortKey(key);
      setAsc(true);
    }
  }

  return (
    <div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} onClick={() => clickHead(c.key)}>
                  {c.label}
                  {sortKey === c.key ? (asc ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.tcga_code}>
                {COLUMNS.map((c) => (
                  <td key={c.key} style={c.wide ? { textAlign: 'left' } : undefined}>
                    {c.text ? r[c.key] ?? '–' : fmt(r[c.key], c.d)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn secondary" onClick={() => onExport('csv')}>
          ⬇ 导出 CSV（后端）
        </button>
        <button className="btn secondary" onClick={() => onExport('client')}>
          ⬇ 导出当前表格
        </button>
      </div>
    </div>
  );
}
