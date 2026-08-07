import { HelpCircle, Keyboard, LayoutDashboard, List, Mail, Settings } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { Separator } from "@/components/ui/separator";
import { AccountCard } from "@/components/AccountCard";
import { LogoMark, LogoWordmark } from "@/components/BrandLogo";
import { SidebarShell, useSidebar } from "@/components/SidebarShell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Shell pages in hotkey order (↑ / ↓ cycle, 1..5 jump — see AuthenticatedLayout). */
export const dashboardNavItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/list", label: "Project list", icon: List },
  { to: "/invitations", label: "Invitations", icon: Mail },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/help", label: "Help & FAQ", icon: HelpCircle },
];

export function Sidebar({
  onStartTour,
  onShowShortcuts,
}: {
  onStartTour: () => void;
  onShowShortcuts: () => void;
}) {
  const { setOpen } = useSidebar();

  return (
    <SidebarShell>
      <div className="flex items-center justify-between px-3 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/dashboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md transition-opacity hover:opacity-80"
            >
              <LogoMark className="h-7 w-7" />
              <LogoWordmark />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Dashboard</TooltipContent>
        </Tooltip>
        <ThemeToggle />
      </div>

      <Separator />

      <nav className="flex-1 space-y-0.5 px-2 py-2" data-tour="sidebar-nav">
        {dashboardNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="px-2">
        <Separator />
      </div>
      <div className="px-2 pt-1.5">
        <button
          onClick={() => { setOpen(false); onStartTour(); }}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          Take a tour
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onShowShortcuts}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <Keyboard className="h-3.5 w-3.5" />
              Keyboard shortcuts
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Also opens with ?</TooltipContent>
        </Tooltip>
      </div>
      <div className="px-2 py-2">
        <AccountCard />
      </div>
    </SidebarShell>
  );
}
