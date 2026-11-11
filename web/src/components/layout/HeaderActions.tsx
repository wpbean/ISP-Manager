import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface HeaderSlot {
  el: HTMLElement | null;
  /** Register/unregister a page that is rendering actions into the top bar. */
  claim: (delta: 1 | -1) => void;
}

export const HeaderSlotContext = createContext<HeaderSlot>({ el: null, claim: () => {} });

/**
 * Renders its children into the sticky top bar (replacing the default "New Customer" button)
 * for as long as the page is mounted.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const { el, claim } = useContext(HeaderSlotContext);
  useEffect(() => {
    claim(1);
    return () => claim(-1);
  }, [claim]);
  return el ? createPortal(children, el) : null;
}
