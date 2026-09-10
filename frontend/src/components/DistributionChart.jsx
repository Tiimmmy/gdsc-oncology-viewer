import { useMemo } from 'react';
import PlotlyChart from './PlotlyChart.jsx';
import Notice from './Notice.jsx';
import { baseLayout, theme } from '../plot.js';

// Ranked horizontal bar of every tumour type by mean sensitivity, with SEM error
// bars. Focus / selected tumour types are highlighted.
export default function DistributionChart({ result, metric, onDownload }) {
  const t = theme();
  const isAuc = metric === 'AUC';
  const valKey = isAuc ? 'mean_auc' : 'geomean_ic50_um';
  const semKey = isAuc ? 'sem_auc' : 'sem_ln_ic50';

  const { data, layout } = useMemo(() => {
    const rows = result.tumour_stats.filter((r) => r.sensitivity_rank !== null);
    // most sensitive at the top
    rows.sort((a, b) => b[valKey] - a[valKey]);
    const focus = new Set(result.focus_codes);

    const y = rows.map((r) => r.tcga_code);
    const x = rows.map((r) => r[valKey]);
    const colors = rows.map((r) => (focus.has(r.tcga_code) ? t.test : t.grid));

    const trace = {
      type: 'bar',
      orientation: 'h',
      x,
      y,
      marker: { color: colors },
      error_x: isAuc
        ? {
            type: 'data',
            array: rows.map((r) => r.sem_auc ?? 0),
            visible: true,
            color: t.muted,
            thickness: 1.5,
            width: 3,
          }
        : undefined,
      customdata: rows.map((r) => [r.tcga_label, r.n_cell_lines]),
      hovertemplate:
        `%{y} — %{customdata[0]}<br>${isAuc ? '均值 AUC' : '几何均值 IC50 (µM)'} = %{x:.3f}` +
        `<br>n(细胞系) = %{customdata[1]}<extra></extra>`,
    };

    return {
      data: [trace],
      layout: baseLayout({
        title: {
          text: `${result.selection.label} · 各 TCGA 肿瘤类型敏感性排序`,
          font: { size: 14 },
        },
        margin: { l: 90, r: 20, t: 40, b: 50 },
        xaxis: {
          title: isAuc ? '均值 AUC（越低越敏感）' : '几何均值 IC50 (µM，对数轴)',
          type: isAuc ? 'linear' : 'log',
          gridcolor: t.grid,
        },
        yaxis: { automargin: true, gridcolor: t.grid },
        showlegend: false,
        height: Math.max(320, rows.length * 22),
      }),
    };
  }, [result, metric]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranked = result.tumour_stats.filter((r) => r.sensitivity_rank !== null);
  const h = Math.max(320, ranked.length * 22);

  if (ranked.length === 0) {
    return (
      <Notice kind="warn" title="无法生成敏感性排序图">
        没有肿瘤类型达到「每癌种最少细胞系数」门槛（当前 {result.min_cell_lines}）。
        可在左侧调低该门槛，或改选样本更充足的癌种。
      </Notice>
    );
  }

  return (
    <PlotlyChart
      data={data}
      layout={layout}
      height={h}
      filename={`distribution_${result.selection.label}`}
      onDownload={onDownload}
    />
  );
}
