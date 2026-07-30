import { Menu, X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface SidebarCtx {
  /** Mobile drawer open state. */
  open: boolean;
  setOpen: (v: boolean) => void;
  /** Desktop collapse state (persisted). */
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  /** Which of the two states the toggle is actually driving right now. */
  isDesktop: boolean;
}

const Ctx = createContext<SidebarCtx>({
  open: false, setOpen: () => {},
  collapsed: false, setCollapsed: () => {},
  isDesktop: false,
});

const COLLAPSED_KEY = "onboardbuddy:sidebar-collapsed";
const DESKTOP_QUERY = "(min-width: 1024px)";
/** Referenced by the toggle's aria-controls (#74/G13). */
export const SIDEBAR_ID = "app-sidebar";

export function useSidebar() {
  return useContext(Ctx);
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setCollapsed = (v: boolean) => {
    setCollapsedState(v);
    try {
      if (v) localStorage.setItem(COLLAPSED_KEY, "1");
      else localStorage.removeItem(COLLAPSED_KEY);
    } catch { /* storage unavailable */ }
  };

  // The toggle drives `collapsed` on desktop and `open` on mobile, so
  // aria-expanded cannot be honest without knowing which. Tracked here rather
  // than re-queried inside the click handler so the announced state and the
  // acted-on state can never disagree.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <Ctx.Provider value={{ open, setOpen, collapsed, setCollapsed, isDesktop }}>
      {children}
    </Ctx.Provider>
  );
}

/**
 * One toggle for every viewport: opens/closes the drawer on small screens,
 * collapses/expands the docked sidebar on desktop. Lives inline in each
 * page's header row (via PageHeader) instead of its own row, so it never
 * shifts content down.
 */
export function SidebarToggle({ className }: { className?: string }) {
  const { open, setOpen, collapsed, setCollapsed, isDesktop } = useSidebar();
  const expanded = isDesktop ? !collapsed : open;
  const toggle = () => {
    if (isDesktop) setCollapsed(!collapsed);
    else setOpen(!open);
  };
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={toggle}
      aria-label="Toggle sidebar"
      // #74/G13: the button announced "Toggle sidebar" and nothing else, so it
      // was impossible to tell whether pressing it would open or close, or what
      // it acted on. The state differs by viewport — collapsed on desktop, the
      // drawer on mobile — and `expanded` reports whichever one it is driving.
      aria-expanded={expanded}
      aria-controls={SIDEBAR_ID}
    >
      {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
    </Button>
  );
}

export function SidebarShell({ children }: { children: ReactNode }) {
  const { open, setOpen, collapsed } = useSidebar();
  const asideRef = useRef<HTMLElement>(null);

  // The mobile drawer doubles as the desktop's permanently-visible static
  // sidebar (same DOM node, gated by `lg:` classes), so it can't be a real
  // Dialog — that would portal/overlay the desktop layout too. Hand-roll the
  // baseline a Dialog gets for free instead: Escape closes, Tab stays
  // contained, background scroll locks, and focus lands inside on open.
  const focusSelector = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
  useEffect(() => {
    if (!open) return;
    const aside = asideRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const initialFocusables = aside?.querySelectorAll<HTMLElement>(focusSelector) ?? [];
    initialFocusables[0]?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const els = Array.from(aside?.querySelectorAll<HTMLElement>(focusSelector) ?? []);
      const first = els[0];
      const last = els[els.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [open, setOpen, focusSelector]);

  // A resize past the desktop breakpoint turns this element back into the
  // static sidebar — close the "modal" so the scroll-lock/focus-trap above
  // don't outlive the overlay they belong to.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => { if (mq.matches) setOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [open, setOpen]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={asideRef}
        id={SIDEBAR_ID}
        role={open ? "dialog" : undefined}
        aria-modal={open ? "true" : undefined}
        aria-label="Sidebar navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-border bg-card transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:hidden" : "lg:static lg:translate-x-0"}`}
      >
        {children}
      </aside>
    </>
  );
}
