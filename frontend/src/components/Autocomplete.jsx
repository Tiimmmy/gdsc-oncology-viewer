import { useEffect, useRef, useState } from 'react';

// Generic async autocomplete. `fetcher(query)` returns a promise of an array of
// items; `render(item)` and `toValue(item)` adapt arbitrary item shapes.
export default function Autocomplete({
  value,
  onChange,
  fetcher,
  placeholder,
  toValue = (x) => x,
  render = (x) => x,
  minChars = 0,
}) {
  const [text, setText] = useState(value || '');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => {
    setText(value || '');
  }, [value]);

  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function runQuery(q) {
    if (q.length < minChars) {
      setItems([]);
      return;
    }
    const my = ++seq.current;
    try {
      const results = await fetcher(q);
      if (my === seq.current) {
        setItems(results);
        setActive(-1);
      }
    } catch {
      if (my === seq.current) setItems([]);
    }
  }

  function handleInput(e) {
    const q = e.target.value;
    setText(q);
    setOpen(true);
    runQuery(q);
  }

  function pick(item) {
    const v = toValue(item);
    setText(v);
    onChange(v, item);
    setOpen(false);
  }

  function handleKey(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (active >= 0 && items[active]) {
        e.preventDefault();
        pick(items[active]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="autocomplete" ref={boxRef}>
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        onChange={handleInput}
        onFocus={() => {
          setOpen(true);
          runQuery(text);
        }}
        onKeyDown={handleKey}
        onBlur={() => {
          // commit free-typed value so it can still be submitted
          if (text !== value) onChange(text, null);
        }}
      />
      {open && items.length > 0 && (
        <div className="autocomplete-list">
          {items.map((it, i) => (
            <div
              key={i}
              className={'autocomplete-item' + (i === active ? ' active' : '')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it);
              }}
            >
              {render(it)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
