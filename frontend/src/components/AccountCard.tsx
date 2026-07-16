import { Settings } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/SidebarShell";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function AccountCard() {
  const { user } = useAuth();
  const { setOpen } = useSidebar();
  const location = useLocation();

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (meta.full_name as string) ||
    (meta.name as string) ||
    user?.email?.split("@")[0] ||
    "Account";
  const title = (meta.title as string) || (meta.role as string) || "Member";

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
      <Avatar className="size-7">
        {typeof meta.avatar_url === "string" && meta.avatar_url !== "" && (
          <AvatarImage src={meta.avatar_url} alt="" />
        )}
        <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground" title={name}>{name}</div>
        <div className="truncate text-xs text-muted-foreground" title={title}>{title}</div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        asChild
        aria-label="Account settings"
        title="Account settings"
      >
        {/* Carry the origin so the settings page's Back returns to the tab
            you came from (e.g. deep inside a project), not the dashboard. */}
        <NavLink to="/settings" state={{ from: location.pathname + location.search }} onClick={() => setOpen(false)}>
          <Settings className="h-3.5 w-3.5" />
        </NavLink>
      </Button>
    </div>
  );
}
