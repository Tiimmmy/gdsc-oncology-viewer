import { useMemo } from 'react';
import PlotlyChart from './PlotlyChart.jsx';
import Notice from './Notice.jsx';
import { baseLayout, theme } from '../plot.js';

// Grouped bar chart: test drug vs control drug, per tumour type, with SEM error
// bars. Metric is either mean AUC or geometric-mean IC50 (uM).
export default function ComparisonChart({ comparison, metric, onDownload }) {
  const t = theme();
  const isAuc = metric === 'AUC';

  const { data, layout, empty } = useMemo(() => {
    const rows = (comparison?.per_tumour_type || []).filter(
      (r) => r.n_cell_lines_test > 0 && r.n_cell_lines_control > 0,
    );
    if (!rows.length) return { empty: true };

    const valKey = isAuc ? 'mean_auc' : 'geomean_ic50_um';
    const semKey = isAuc ? 'sem_auc' : null;

    rows.sort((a, b) => a[`test_${valKey}`] - b[`test_${valKey}`]);
    const x = rows.map((r) => r.tcga_code);

    const mkTrace = (side, color) => ({
      type: 'bar',
      name: side === 'test' ? comparison.test_label : comparison.control_label,
      x,
      y: rows.map((r) => r[`${side}_${valKey}`]),
      error_y: semKey
        ? {
            type: 'data',
            array: rows.map((r) => r[`${side}_${semKey}`] ?? 0),
            visible: true,
            color: t.muted,
            thickness: 1.5,
            width: 4,
          }
        : undefined,
      marker: { color, line: { width: 0 } },
      hovertemplate:
        `%{x} · ${side === 'test' ? comparison.test_label : comparison.control_label}` +
        `<br>${isAuc ? '均值 AUC' : '几何均值 IC50 (µM)'} = %{y:.3f}<extra></extra>`,
    });

    return {
      data: [mkTrace('test', t.test), mkTrace('control', t.control)],
      layout: baseLayout({
        title: {
          text: `${comparison.test_label} vs ${comparison.control_label} · ${
            isAuc ? '均值 AUC' : '几何均值 IC50'
          }`,
          font: { size: 14 },
        },
        barmode: 'group',
        yaxis: {
          title: isAuc ? '均值 AUC' : '几何均值 IC50 (µM)',
          type: isAuc ? 'linear' : 'log',
          gridcolor: t.grid,
        },
        xaxis: { title: 'TCGA 肿瘤类型', tickangle: -35, gridcolor: t.grid },
      }),
    };
  }, [comparison, metric]); // eslint-disable-line react-hooks/exhaustive-deps

  if (empty)
    return (
      <Notice kind="empty" title="无可比较的肿瘤类型">
        待测药与对照药在所选肿瘤类型上没有共同的细胞系数据。
      </Notice>
    );

  return (
    <PlotlyChart
      data={data}
      layout={layout}
      height={430}
      filename={`compare_${comparison.test_label}_vs_${comparison.control_label}`}
      onDownload={onDownload}
    />
  );
}
