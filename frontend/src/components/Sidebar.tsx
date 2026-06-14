import {
  LayoutDashboard,
  List,
  LogOut,
  Mail,
  Settings,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarShell, useSidebar } from "@/components/SidebarShell";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/import", label: "Project list", icon: List },
  { to: "/invitations", label: "Invitations", icon: Mail },
];

export function Sidebar() {
  const { user, signOut } = useAuth();
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
        <div className="mb-1 truncate px-2.5 text-[11px] text-muted-foreground">
          {user?.email}
        </div>
        <NavLink
          to="/settings"
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`
          }
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </NavLink>
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-2.5 px-2.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          onClick={() => signOut()}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign Out
        </Button>
      </div>
    </SidebarShell>
  );
}
