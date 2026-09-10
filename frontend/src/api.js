// Thin JSON API client. All endpoints are served by the FastAPI backend and
// proxied through Vite at /api during development.

const BASE = import.meta.env.VITE_API_BASE || '';

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export function getMeta(sessionId) {
  const q = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
  return request(`/api/meta${q}`);
}

export function searchDrugs(q, dataset, limit = 30, sessionId) {
  const params = new URLSearchParams({ q: q || '', limit: String(limit) });
  if (dataset) params.set('dataset', dataset);
  if (sessionId) params.set('session_id', sessionId);
  return request(`/api/drugs?${params.toString()}`);
}

export function analyze(payload) {
  return request('/api/analyze', { method: 'POST', body: JSON.stringify(payload) });
}

export function screen(payload) {
  return request('/api/screen', { method: 'POST', body: JSON.stringify(payload) });
}

// Upload an Excel/CSV file; the backend holds it in memory only.
export async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(BASE + '/api/upload', { method: 'POST', body: fd });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.detail || `上传失败 (${res.status})`);
    err.info = body.info;
    throw err;
  }
  return body;
}

export function deleteSession(sessionId) {
  if (!sessionId) return Promise.resolve();
  return fetch(BASE + `/api/session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  }).catch(() => {});
}

// Fire-and-forget cleanup on tab close / refresh (sendBeacon can only POST).
export function dropSessionBeacon(sessionId) {
  if (!sessionId) return;
  try {
    navigator.sendBeacon(BASE + `/api/session/${encodeURIComponent(sessionId)}/drop`);
  } catch {
    /* ignore */
  }
}

// Triggers a CSV file download from a POST endpoint.
export async function downloadCsv(path, payload, filename) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Builds a CSV string from an array of row objects and triggers a download.
export function exportRowsAsCsv(rows, filename) {
  if (!rows || !rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
