import { Menu, X } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface SidebarCtx {
  /** Mobile drawer open state. */
  open: boolean;
  setOpen: (v: boolean) => void;
  /** Desktop collapse state (persisted). */
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const Ctx = createContext<SidebarCtx>({
  open: false, setOpen: () => {},
  collapsed: false, setCollapsed: () => {},
});

const COLLAPSED_KEY = "onboardbuddy:sidebar-collapsed";

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
  return <Ctx.Provider value={{ open, setOpen, collapsed, setCollapsed }}>{children}</Ctx.Provider>;
}

/**
 * One toggle for every viewport: opens/closes the drawer on small screens,
 * collapses/expands the docked sidebar on desktop.
 */
export function SidebarToggle() {
  const { open, setOpen, collapsed, setCollapsed } = useSidebar();
  const toggle = () => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setCollapsed(!collapsed);
    } else {
      setOpen(!open);
    }
  };
  return (
    <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle sidebar">
      {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
    </Button>
  );
}

export function SidebarShell({ children }: { children: ReactNode }) {
  const { open, setOpen, collapsed } = useSidebar();

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-border bg-card transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:hidden" : "lg:static lg:translate-x-0"}`}
      >
        {children}
      </aside>
    </>
  );
}
