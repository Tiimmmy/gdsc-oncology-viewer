import { useMemo } from 'react';
import PlotlyChart from './PlotlyChart.jsx';
import Notice from './Notice.jsx';
import { baseLayout, theme } from '../plot.js';

// Box-and-whisker of the per-cell-line metric for each focus tumour type, with
// the group mean +/- SEM drawn as an error bar on top. Tumour types with too few
// cell lines for a meaningful box are excluded (backend `plot_guidance`).
export default function SensitivityBoxplot({ result, metric, onDownload }) {
  const t = theme();
  const isAuc = metric === 'AUC';
  const yKey = isAuc ? 'auc' : 'ln_ic50';
  const meanKey = isAuc ? 'mean_auc' : 'mean_ln_ic50';
  const semKey = isAuc ? 'sem_auc' : 'sem_ln_ic50';
  const guidance = result.plot_guidance || {};
  const plotCodes = guidance.boxplot_codes || result.focus_codes;

  const { data, layout } = useMemo(() => {
    const codes = plotCodes;
    const points = result.points.test || {};
    const summary = Object.fromEntries(result.box_summary.map((r) => [r.tcga_code, r]));

    // order categories by median sensitivity (more sensitive first)
    const ordered = [...codes].sort((a, b) => {
      const sa = summary[a]?.[meanKey] ?? Infinity;
      const sb = summary[b]?.[meanKey] ?? Infinity;
      return sa - sb;
    });

    const boxTrace = {
      type: 'box',
      name: '细胞系分布',
      x: [],
      y: [],
      boxpoints: 'all',
      jitter: 0.4,
      pointpos: 0,
      marker: { size: 4, color: t.test, opacity: 0.5 },
      line: { color: t.test },
      fillcolor: 'rgba(42,120,214,0.12)',
      hovertemplate: '%{x}<br>' + (isAuc ? 'AUC' : 'ln(IC50)') + ' = %{y:.3f}<extra></extra>',
    };
    const text = [];
    ordered.forEach((code) => {
      (points[code] || []).forEach((p) => {
        boxTrace.x.push(code);
        boxTrace.y.push(p[yKey]);
        text.push(p.cell_line);
      });
    });
    boxTrace.text = text;

    const meanTrace = {
      type: 'scatter',
      mode: 'markers',
      name: '均值 ± SEM',
      x: ordered,
      y: ordered.map((c) => summary[c]?.[meanKey] ?? null),
      error_y: {
        type: 'data',
        array: ordered.map((c) => summary[c]?.[semKey] ?? 0),
        visible: true,
        color: t.control,
        thickness: 2,
        width: 6,
      },
      marker: { color: t.control, size: 9, symbol: 'diamond', line: { color: t.paper, width: 1 } },
      hovertemplate:
        '%{x}<br>均值 = %{y:.3f}<br>n(细胞系) = %{customdata}<extra></extra>',
      customdata: ordered.map((c) => summary[c]?.n_cell_lines ?? 0),
    };

    return {
      data: [boxTrace, meanTrace],
      layout: baseLayout({
        title: {
          text: `${result.selection.label} · 各癌种${isAuc ? ' AUC ' : ' ln(IC50) '}分布`,
          font: { size: 14 },
        },
        yaxis: {
          title: isAuc ? 'AUC（越低越敏感）' : 'ln(IC50)  µM（越低越敏感）',
          gridcolor: t.grid,
          zeroline: !isAuc,
        },
        xaxis: { title: 'TCGA 肿瘤类型', gridcolor: t.grid, tickangle: -35 },
        boxmode: 'group',
        showlegend: true,
      }),
    };
  }, [result, metric]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plotCodes.length) {
    return (
      <Notice kind="warn" title="样本量不足，未生成箱线图">
        {guidance.messages?.[0] ||
          `所选肿瘤类型的细胞系数均少于 ${guidance.box_min_cell_lines || 3}，无法绘制有意义的箱线图。下方统计表仍然可用。`}
      </Notice>
    );
  }

  return (
    <>
      {guidance.insufficient_codes?.length > 0 && (
        <Notice kind="warn">
          已从箱线图屏蔽样本过少的癌种：
          {guidance.insufficient_codes
            .map((d) => `${d.tcga_code}(n=${d.n_cell_lines})`)
            .join('、')}
        </Notice>
      )}
      <PlotlyChart
        data={data}
        layout={layout}
        height={460}
        filename={`boxplot_${result.selection.label}`}
        onDownload={onDownload}
      />
    </>
  );
}
