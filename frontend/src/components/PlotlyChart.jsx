import { useEffect, useRef } from 'react';
import { Plotly, config } from '../plot.js';

// Declarative wrapper around Plotly.react with a PNG-download helper exposed to
// the parent through the `onReady` callback.
export default function PlotlyChart({ data, layout, filename = 'chart', height = 420, onDownload }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    Plotly.react(ref.current, data, layout, config(filename));
  }, [data, layout, filename]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) Plotly.purge(el);
    };
  }, []);

  useEffect(() => {
    if (onDownload) {
      onDownload(() =>
        Plotly.downloadImage(ref.current, {
          format: 'png',
          filename,
          scale: 2,
          width: ref.current.clientWidth,
          height,
        }),
      );
    }
  }, [onDownload, filename, height]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
