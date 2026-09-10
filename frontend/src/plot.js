// Shared Plotly helpers: a single import point plus theme-aware layout defaults
// and a consistent export config.
import Plotly from 'plotly.js-dist-min';

export { Plotly };

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function theme() {
  return {
    paper: cssVar('--surface-1', '#fff'),
    surface: cssVar('--surface-1', '#fff'),
    text: cssVar('--text-primary', '#0b0b0b'),
    muted: cssVar('--text-secondary', '#52514e'),
    grid: cssVar('--border', '#e2e2dd'),
    test: cssVar('--test-color', '#2a78d6'),
    control: cssVar('--control-color', '#eb6834'),
    series: [
      cssVar('--series-1', '#2a78d6'),
      cssVar('--series-2', '#eb6834'),
      cssVar('--series-3', '#1baf7a'),
      cssVar('--series-4', '#eda100'),
      cssVar('--series-5', '#e87ba4'),
      cssVar('--series-6', '#008300'),
      cssVar('--series-7', '#4a3aa7'),
      cssVar('--series-8', '#e34948'),
    ],
  };
}

export function baseLayout(overrides = {}) {
  const t = theme();
  return {
    paper_bgcolor: t.paper,
    plot_bgcolor: t.surface,
    font: {
      color: t.text,
      family:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
      size: 12,
    },
    margin: { l: 60, r: 20, t: 40, b: 80 },
    hovermode: 'closest',
    legend: { orientation: 'h', y: -0.25, x: 0 },
    xaxis: { gridcolor: t.grid, zerolinecolor: t.grid, automargin: true },
    yaxis: { gridcolor: t.grid, zerolinecolor: t.grid, automargin: true },
    ...overrides,
  };
}

export function config(filename) {
  return {
    responsive: true,
    displaylogo: false,
    toImageButtonOptions: { format: 'png', filename, scale: 2 },
    modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
  };
}
