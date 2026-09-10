import { useMemo, useRef, useState } from 'react';
import PlotlyChart from './PlotlyChart.jsx';
import Notice from './Notice.jsx';
import { baseLayout, theme } from '../plot.js';
import { downloadCsv, exportRowsAsCsv } from '../api.js';

const fmt = (v, d = 3) =>
  v === null || v === undefined || Number.isNaN(v)
    ? '–'
    : Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)
    ? v.toExponential(2)
    : Number(v).toFixed(d);

const GROUP_LABEL = { drug: '药物', target: '靶点', pathway: '通路' };

export default function ScreenResults({ result, payload }) {
  const t = theme();
  const dlRef = useRef(null);
  const [showAll, setShowAll] = useState(false);
  const p = result.params;
  const rows = showAll ? result.all_groups : result.hits;

  const chart = useMemo(() => {
    const top = (result.hits.length ? result.hits : result.all_groups).slice(0, 25);
    if (!top.length) return null;
    const ordered = [...top].sort((a, b) => a.value - b.value);
    const y = ordered.map((r) => r.name);
    const x = ordered.map((r) => r.value);
    const pass = ordered.map((r) => r.passes);
    return {
      data: [
        {
          type: 'bar',
          orientation: 'h',
          x,
          y,
          marker: { color: pass.map((ok) => (ok ? t.series[2] : t.grid)) },
          error_x: {
            type: 'data',
            array: ordered.map((r) => r.sem ?? 0),
            visible: true,
            color: t.muted,
            thickness: 1.5,
            width: 3,
          },
          customdata: ordered.map((r) => [r.n_cell_lines, r.n_tumour_types_covered]),
          hovertemplate:
            `%{y}<br>${p.metric_label} = %{x:.3f}` +
            `<br>n(细胞系) = %{customdata[0]} · 覆盖癌种 = %{customdata[1]}<extra></extra>`,
        },
      ],
      layout: baseLayout({
        title: { text: `阈值筛选命中（按 ${p.metric_label}）`, font: { size: 14 } },
        margin: { l: 150, r: 20, t: 40, b: 50 },
        xaxis: {
          title: p.metric_label + (p.metric === 'IC50_UM' ? '（对数轴）' : ''),
          type: p.metric === 'IC50_UM' ? 'log' : 'linear',
          gridcolor: t.grid,
        },
        yaxis: { automargin: true, gridcolor: t.grid },
        shapes: [
          {
            type: 'line',
            x0: p.threshold,
            x1: p.threshold,
            yref: 'paper',
            y0: 0,
            y1: 1,
            line: { color: t.series[7], width: 2, dash: 'dash' },
          },
        ],
        annotations: [
          {
            x: p.threshold,
            yref: 'paper',
            y: 1.02,
            text: `阈值 ${p.threshold}`,
            showarrow: false,
            font: { color: t.series[7], size: 11 },
          },
        ],
        showlegend: false,
        height: Math.max(300, ordered.length * 24),
      }),
    };
  }, [result, p]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <section className="card">
        <h2>阈值筛选结果</h2>
        <p className="card-sub">
          在 {p.tumour_types.join(' / ')} 中，按<strong>{GROUP_LABEL[p.group_by]}</strong>聚合，
          {p.metric_label} {p.direction === 'below' ? '低于' : '高于'} {p.threshold}
          （每组 ≥{p.min_cell_lines} 细胞系）的命中项。
          {p.missing_tumour_types?.length > 0 && (
            <span style={{ color: 'var(--danger)' }}>
              {' '}忽略了无数据的癌种：{p.missing_tumour_types.join('、')}。
            </span>
          )}
        </p>
        <div className="summary-grid">
          <div className="stat-tile">
            <div className="k">评估{GROUP_LABEL[p.group_by]}数</div>
            <div className="v">{result.summary.n_evaluated}</div>
          </div>
          <div className="stat-tile">
            <div className="k">命中数（达标）</div>
            <div className="v">{result.summary.n_hits}</div>
          </div>
          <div className="stat-tile">
            <div className="k">优于阈值（未计细胞系门槛）</div>
            <div className="v">{result.summary.n_beats_threshold}</div>
          </div>
          {result.summary.best && (
            <div className="stat-tile">
              <div className="k">最佳</div>
              <div className="v">
                {result.summary.best.name}{' '}
                <small>{p.metric_label} {fmt(result.summary.best.value)}</small>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>命中排序图</h2>
            <p className="card-sub">绿色为达标项，灰色为未达标；虚线为阈值，误差棒为 SEM。</p>
          </div>
          {chart && (
            <button className="btn secondary" onClick={() => dlRef.current?.()}>
              ⬇ PNG
            </button>
          )}
        </div>
        {chart ? (
          <PlotlyChart
            data={chart.data}
            layout={chart.layout}
            height={chart.layout.height}
            filename={`screen_${p.group_by}_${p.metric}`}
            onDownload={(fn) => {
              dlRef.current = fn;
            }}
          />
        ) : (
          <Notice kind="empty" title="没有可绘制的结果">
            当前阈值下没有任何{GROUP_LABEL[p.group_by]}命中，可放宽阈值或降低细胞系门槛。
          </Notice>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>{showAll ? '全部评估项' : '命中明细'}</h2>
            <p className="card-sub">点击行内癌种查看分癌种均值。</p>
          </div>
          <div className="toolbar">
            <button className="btn secondary" onClick={() => setShowAll((s) => !s)}>
              {showAll ? '仅看命中' : '看全部'}
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <Notice kind="empty" title="无数据">没有符合条件的记录。</Notice>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>{GROUP_LABEL[p.group_by]}</th>
                  <th>{p.metric_label}</th>
                  <th>SEM</th>
                  <th>细胞系数</th>
                  <th>覆盖癌种</th>
                  {p.group_by === 'drug' && <th style={{ textAlign: 'left' }}>靶点</th>}
                  {p.group_by !== 'drug' && <th>药物数</th>}
                  <th>达标</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td style={{ textAlign: 'left' }} title={r.per_tumour_type.map((x) => `${x.tcga_code}: ${fmt(x.value)}`).join('  |  ')}>
                      {r.name}
                    </td>
                    <td>{fmt(r.value)}</td>
                    <td>{fmt(r.sem)}</td>
                    <td>{r.n_cell_lines}</td>
                    <td>{r.n_tumour_types_covered}</td>
                    {p.group_by === 'drug' && (
                      <td style={{ textAlign: 'left' }}>{r.targets.join(', ') || '–'}</td>
                    )}
                    {p.group_by !== 'drug' && <td>{r.n_drugs}</td>}
                    <td>
                      {r.passes ? (
                        <span className="badge sig">达标</span>
                      ) : (
                        <span className="badge ns">
                          {r.beats_threshold ? '细胞系不足' : '未达阈值'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="toolbar" style={{ marginTop: 12 }}>
          <button
            className="btn secondary"
            onClick={() =>
              downloadCsv('/api/export/screen.csv', payload, `screen_${p.group_by}_${p.metric}.csv`)
            }
          >
            ⬇ 导出 CSV（后端，全部评估项）
          </button>
          <button
            className="btn secondary"
            onClick={() =>
              exportRowsAsCsv(
                rows.map((r) => ({
                  name: r.name,
                  value: r.value,
                  sem: r.sem,
                  n_cell_lines: r.n_cell_lines,
                  n_tumour_types_covered: r.n_tumour_types_covered,
                  passes: r.passes,
                  beats_threshold: r.beats_threshold,
                  targets: r.targets.join('; '),
                })),
                `screen_${p.group_by}_${p.metric}_client.csv`,
              )
            }
          >
            ⬇ 导出当前表格
          </button>
        </div>
      </section>
    </>
  );
}
