import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getUiState, setUiState } from '../../vscodeApi';

interface Props {
  storageKey: string;
  defaultRatio: number;
  min?: number;
  max?: number;
  left: ReactNode;
  right: ReactNode;
  /** 'horizontal' = left|right, 'vertical' = top/bottom (narrow side bars). */
  direction?: 'horizontal' | 'vertical';
}

/** Split with a draggable gutter; ratio = first pane fraction. */
export function SplitPane({
  storageKey,
  defaultRatio,
  min = 0.15,
  max = 0.85,
  left,
  right,
  direction = 'horizontal',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vertical = direction === 'vertical';
  // Each orientation keeps its own ratio: 60/40 side-by-side and 60/40
  // stacked are different layouts.
  const key = vertical ? `${storageKey}:v` : storageKey;
  const [ratio, setRatio] = useState(() => getUiState<number>(key) ?? defaultRatio);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setRatio(getUiState<number>(key) ?? defaultRatio);
  }, [key, defaultRatio]);

  const onMove = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const size = vertical ? rect.height : rect.width;
    if (size === 0) return;
    const pos = vertical ? clientY - rect.top : clientX - rect.left;
    setRatio(Math.min(max, Math.max(min, pos / size)));
  };

  const stop = () => {
    setDragging(false);
    setUiState(key, ratio);
  };

  return (
    <div className={`split-pane${vertical ? ' vertical' : ''}`} ref={containerRef}>
      <div className="split-left" style={{ flexBasis: `${ratio * 100}%` }}>
        {left}
      </div>
      <div
        className={`split-gutter${dragging ? ' dragging' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
      />
      <div className="split-right">{right}</div>
      {dragging && (
        <div
          className={`split-overlay${vertical ? ' vertical' : ''}`}
          onMouseMove={(e) => onMove(e.clientX, e.clientY)}
          onMouseUp={stop}
          onMouseLeave={stop}
        />
      )}
    </div>
  );
}
