import { Menu, X } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface SidebarCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
}

const Ctx = createContext<SidebarCtx>({ open: false, setOpen: () => {} });

export function useSidebar() {
  return useContext(Ctx);
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}

export function SidebarToggle() {
  const { open, setOpen } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="lg:hidden"
      onClick={() => setOpen(!open)}
    >
      {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
    </Button>
  );
}

export function SidebarShell({ children }: { children: ReactNode }) {
  const { open, setOpen } = useSidebar();

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-border bg-card transition-transform lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {children}
      </aside>
    </>
  );
}
