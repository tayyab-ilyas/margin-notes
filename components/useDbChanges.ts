import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Broadcast } from '../lib/messages';

/**
 * Counter that increments whenever the background reports a DB write.
 * Dexie's liveQuery already notices changes across extension contexts; this is
 * a cheap safety net, used as an extra dependency of live queries.
 */
export function useDbChanges(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const onMsg = (msg: unknown) => {
      if ((msg as Broadcast)?.type === 'dbChanged') setN((x) => x + 1);
    };
    browser.runtime.onMessage.addListener(onMsg);
    return () => browser.runtime.onMessage.removeListener(onMsg);
  }, []);
  return n;
}
