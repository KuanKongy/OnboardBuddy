import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { MAIN_REGION_ID } from "@/hooks/usePageChrome";
import { cn } from "@/lib/utils";

/**
 * The scrolling `<main>` both app shells render, plus a way for a page to ask
 * for it without padding.
 *
 * A reader/editor page that draws its own full-width dividers (the onboarding
 * reader, the settings pages) needs its borders to touch the window walls,
 * which the shell's `p-3 sm:p-4 lg:p-5` makes impossible from inside the page.
 * Negative margins were the other option and lose: they break the `h-full`
 * math these pages depend on and inset the scrollbar by the padding.
 *
 * Setter and value live in separate contexts so a page calling
 * `useFullBleedMain` doesn't re-render every time the flag flips.
 */
const FullBleedCtx = createContext(false);
const SetFullBleedCtx = createContext<(v: boolean) => void>(() => {});

export function MainChromeProvider({ children }: { children: ReactNode }) {
  const [fullBleed, setFullBleed] = useState(false);
  return (
    <SetFullBleedCtx.Provider value={setFullBleed}>
      <FullBleedCtx.Provider value={fullBleed}>{children}</FullBleedCtx.Provider>
    </SetFullBleedCtx.Provider>
  );
}

/**
 * Drop the shell's padding for as long as this component is mounted (and
 * `enabled`). `useLayoutEffect`, not `useEffect`: on a deep link straight into
 * a full-bleed page the padded frame would otherwise paint for one frame.
 *
 * The default context setter is a no-op, so a page test that renders without
 * the provider — every reader test does — behaves exactly as before.
 */
export function useFullBleedMain(enabled = true) {
  const setFullBleed = useContext(SetFullBleedCtx);
  useLayoutEffect(() => {
    setFullBleed(enabled);
    return () => setFullBleed(false);
  }, [enabled, setFullBleed]);
}

export function MainRegion({ children }: { children: ReactNode }) {
  const fullBleed = useContext(FullBleedCtx);
  return (
    // `outline-none`: usePageChrome focuses this on every route change, and a
    // ring around the whole page would be a new visual on navigation.
    <main
      id={MAIN_REGION_ID}
      tabIndex={-1}
      className={cn("flex-1 overflow-y-auto bg-background outline-none", !fullBleed && "p-3 sm:p-4 lg:p-5")}
    >
      {children}
    </main>
  );
}
