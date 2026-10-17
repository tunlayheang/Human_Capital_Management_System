import { useEffect, useState } from 'react';

/** Matches Layout.tsx / Tailwind `lg` — overlay sidebar + bottom nav below this width */
export const LAYOUT_COMPACT_MAX_PX = 1023;

const COMPACT_MQL = `(max-width: ${LAYOUT_COMPACT_MAX_PX}px)`;

/** Phone/tablet: use full `/chat` page instead of the floating dock. */
export function prefersFullPageChat(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(COMPACT_MQL).matches;
}

export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(COMPACT_MQL).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(COMPACT_MQL);
    const onChange = () => setCompact(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return compact;
}

/** Single-pane chat below `lg`; split list + thread at desktop */
export function useChatSplitPane(variant: 'desktop' | 'widget'): boolean {
  const query =
    variant === 'desktop'
      ? `(max-width: ${LAYOUT_COMPACT_MAX_PX}px)`
      : '(max-width: 767px)';

  const [singlePane, setSinglePane] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setSinglePane(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return singlePane;
}
