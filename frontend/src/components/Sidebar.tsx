import { LayoutDashboard, List, Mail, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Separator } from "@/components/ui/separator";
import { AccountCard } from "@/components/AccountCard";
import { SidebarShell, useSidebar } from "@/components/SidebarShell";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/list", label: "Project list", icon: List },
  { to: "/invitations", label: "Invitations", icon: Mail },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const { setOpen } = useSidebar();

  return (
    <SidebarShell>
      <div className="flex items-center gap-2 px-3 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          OB
        </div>
        <span className="text-sm font-semibold text-foreground">OnboardBuddy</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
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
      <div className="px-2 py-2">
        <AccountCard />
      </div>
    </SidebarShell>
  );
}
