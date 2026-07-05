import { useSyncExternalStore, type ReactNode } from 'react';

const emptySubscribe = () => () => {};

/** Renders children only after hydration — required for the WebGL canvas under SSR. */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  return <>{hydrated ? children : fallback}</>;
}
