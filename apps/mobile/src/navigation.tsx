import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'editor'; albumId: string }
  | { name: 'wizard' }
  | { name: 'diagnostics' };

interface Nav {
  route: Route;
  canGoBack: boolean;
  navigate(route: Route): void;
  replace(route: Route): void;
  back(): void;
}

const NavContext = createContext<Nav | null>(null);

/** Navigation minimaliste par pile, sans dépendance externe. */
export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const navigate = useCallback((route: Route) => setStack((s) => [...s, route]), []);
  const replace = useCallback((route: Route) => setStack((s) => [...s.slice(0, -1), route]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const value = useMemo<Nav>(
    () => ({ route: stack[stack.length - 1]!, canGoBack: stack.length > 1, navigate, replace, back }),
    [stack, navigate, replace, back],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNavigation(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('NavigationProvider manquant');
  return nav;
}
