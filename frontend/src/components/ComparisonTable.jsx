import { exportRowsAsCsv, downloadCsv } from '../api.js';

const fmt = (v, d = 3) =>
  v === null || v === undefined || Number.isNaN(v)
    ? '–'
    : Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)
    ? v.toExponential(2)
    : Number(v).toFixed(d);

const pfmt = (p) =>
  p === null || p === undefined
    ? '–'
    : p < 0.001
    ? p.toExponential(1)
    : p.toFixed(3);

function Sig({ p }) {
  if (p === null || p === undefined) return <span className="badge ns">n/a</span>;
  return p < 0.05 ? (
    <span className="badge sig">p={pfmt(p)}</span>
  ) : (
    <span className="badge ns">p={pfmt(p)}</span>
  );
}

export default function ComparisonTable({ comparison, payload }) {
  const rows = comparison.per_tumour_type;

  return (
    <div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>TCGA</th>
              <th>肿瘤类型</th>
              <th>n 待测/对照</th>
              <th>待测 IC50 (µM)</th>
              <th>对照 IC50 (µM)</th>
              <th>IC50 倍数<br />(待测/对照)</th>
              <th>待测 AUC</th>
              <th>对照 AUC</th>
              <th>ΔAUC</th>
              <th>更强效</th>
              <th>ln(IC50) 检验</th>
              <th>AUC 检验</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tcga_code}>
                <td>{r.tcga_code}</td>
                <td style={{ textAlign: 'left' }}>{r.tcga_label}</td>
                <td>
                  {r.n_cell_lines_test}/{r.n_cell_lines_control}
                </td>
                <td>{fmt(r.test_geomean_ic50_um)}</td>
                <td>{fmt(r.control_geomean_ic50_um)}</td>
                <td className={r.ic50_fold_change < 1 ? 'pos' : 'neg'}>
                  {fmt(r.ic50_fold_change)}×
                </td>
                <td>{fmt(r.test_mean_auc)}</td>
                <td>{fmt(r.control_mean_auc)}</td>
                <td className={r.delta_mean_auc < 0 ? 'pos' : 'neg'}>
                  {fmt(r.delta_mean_auc)}
                </td>
                <td style={{ textAlign: 'left' }}>
                  {r.more_potent === 'test' ? comparison.test_label : comparison.control_label}
                </td>
                <td>
                  <Sig p={r.ln_ic50_test_vs_control.welch_p} />
                </td>
                <td>
                  <Sig p={r.auc_test_vs_control.welch_p} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="toolbar" style={{ marginTop: 12 }}>
        <button
          className="btn secondary"
          onClick={() =>
            downloadCsv(
              '/api/export/comparison.csv',
              payload,
              `${comparison.test_label}_vs_${comparison.control_label}.csv`,
            )
          }
        >
          ⬇ 导出对照对比 CSV
        </button>
        <button
          className="btn secondary"
          onClick={() =>
            exportRowsAsCsv(
              rows.map((r) => ({
                tcga_code: r.tcga_code,
                tcga_label: r.tcga_label,
                n_test: r.n_cell_lines_test,
                n_control: r.n_cell_lines_control,
                test_ic50_um: r.test_geomean_ic50_um,
                control_ic50_um: r.control_geomean_ic50_um,
                ic50_fold_change: r.ic50_fold_change,
                test_mean_auc: r.test_mean_auc,
                control_mean_auc: r.control_mean_auc,
                delta_auc: r.delta_mean_auc,
                more_potent: r.more_potent,
                ln_ic50_welch_p: r.ln_ic50_test_vs_control.welch_p,
                ln_ic50_mannwhitney_p: r.ln_ic50_test_vs_control.mannwhitney_p,
                auc_welch_p: r.auc_test_vs_control.welch_p,
                auc_mannwhitney_p: r.auc_test_vs_control.mannwhitney_p,
              })),
              `${comparison.test_label}_vs_${comparison.control_label}_client.csv`,
            )
          }
        >
          ⬇ 导出当前表格
        </button>
      </div>
    </div>
  );
}
