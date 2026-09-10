// Small inline notice used as a fallback where a chart or section can't render.
export default function Notice({ kind = 'info', title, children }) {
  const palette = {
    info: { bg: 'var(--accent-weak)', fg: 'var(--accent)' },
    warn: { bg: '#fff4e5', fg: '#9a6400' },
    empty: { bg: 'var(--surface-2)', fg: 'var(--text-muted)' },
  }[kind] || {};
  return (
    <div
      style={{
        background: palette.bg,
        color: palette.fg,
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '14px 16px',
        fontSize: 13,
      }}
    >
      {title && <strong style={{ display: 'block', marginBottom: children ? 4 : 0 }}>{title}</strong>}
      {children}
    </div>
  );
}
