import { useEffect, useState } from 'react';

/** Live `window.matchMedia` result, e.g. `useMediaQuery('(pointer: coarse)')`. */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Below Tailwind `lg` (1024px): phones and portrait tablets. */
export const COMPACT_QUERY = '(max-width: 1023.98px)';
/** Touch screens (finger, not mouse). */
export const TOUCH_QUERY = '(pointer: coarse)';
