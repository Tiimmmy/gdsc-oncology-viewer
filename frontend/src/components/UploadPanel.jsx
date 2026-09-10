import { useRef, useState } from 'react';
import { uploadFile } from '../api.js';

const DROP_LABELS = {
  missing_required: '必填字段缺失',
  auc_out_of_range: 'AUC 超出 [0,1]',
  ic50_illegal_or_extreme: 'IC50 非法 / 极端值',
  replicate_rows_collapsed: '重复筛选记录合并',
};

export default function UploadPanel({ session, onUploaded, onCleared }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await uploadFile(file);
      onUploaded(res);
    } catch (e) {
      setError({ message: e.message, info: e.info });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const report = session?.cleaning_report;

  return (
    <div className="field">
      <label>
        上传 GDSC 子集文件 <span className="hint">(.xlsx / .xls / .csv)</span>
      </label>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        disabled={busy}
        onChange={(e) => handleFile(e.target.files?.[0])}
        style={{ fontSize: 12 }}
      />
      {busy && <p className="footnote">正在校验并解析…</p>}

      <p className="footnote" style={{ marginTop: 6 }}>
        🔒 上传数据仅保存在服务器内存中，不落盘、不缓存；关闭或刷新页面即清除。
      </p>

      {error && (
        <div className="error-box" style={{ marginTop: 10 }}>
          {error.message}
          {error.info?.missing_fields && (
            <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
              {error.info.missing_fields.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {error.info?.columns_in && (
            <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8 }}>
              文件中的列：{error.info.columns_in.join(', ')}
            </div>
          )}
        </div>
      )}

      {session && report && (
        <div
          style={{
            marginTop: 10,
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 10,
            background: 'var(--surface-2)',
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            ✓ {session.filename}
          </div>
          <div>
            有效记录 <strong>{report.rows_out?.toLocaleString?.() ?? report.rows_out}</strong> /
            原始 {report.rows_in?.toLocaleString?.() ?? report.rows_in} 行
          </div>
          <div>
            {session.counts.drugs} 药物 · {session.counts.targets} 靶点 ·{' '}
            {session.counts.pathways} 通路 · {session.counts.tumour_types} 肿瘤类型
          </div>
          {report.dropped && Object.values(report.dropped).some((v) => v > 0) && (
            <div style={{ marginTop: 4 }}>
              已过滤：
              {Object.entries(report.dropped)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => `${DROP_LABELS[k] || k} ${v}`)
                .join('、')}
            </div>
          )}
          {report.warnings?.length > 0 && (
            <ul style={{ margin: '4px 0 0 16px', padding: 0, color: '#9a6400' }}>
              {report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 4, opacity: 0.7 }}>
            会话将在约 {Math.round((session.expires_in_seconds || 0) / 60)} 分钟无操作后过期
          </div>
          <button
            className="btn secondary"
            style={{ marginTop: 8, padding: '4px 10px', fontSize: 12 }}
            onClick={onCleared}
          >
            清除上传数据
          </button>
        </div>
      )}
    </div>
  );
}
