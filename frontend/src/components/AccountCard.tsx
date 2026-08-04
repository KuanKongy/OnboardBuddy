import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { safeAvatarSrc } from "@/lib/avatarUrl";
import { displayName } from "@/lib/displayName";
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
  const name = displayName(user);
  const title = (meta.title as string) || (meta.role as string) || "Member";

  return (
    // The whole card is the control: the gear button that used to sit beside it
    // made the card look clickable while only a 24px target actually was. Carry
    // the origin so the settings page's Back returns to the tab you came from
    // (e.g. deep inside a project), not the dashboard.
    <NavLink
      to="/settings"
      state={{ from: location.pathname + location.search }}
      onClick={() => setOpen(false)}
      aria-label="Account settings"
      className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 transition-colors hover:bg-accent/50"
    >
      <Avatar className="size-7">
        {/* Guarded: values stored before the allowlist existed are still
            in Supabase, and only this check stops them beaconing (§5.3). */}
        {safeAvatarSrc(meta.avatar_url as string | undefined) && (
          <AvatarImage src={safeAvatarSrc(meta.avatar_url as string | undefined)} alt="" />
        )}
        <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.8125rem] font-medium text-foreground">{name}</div>
        <div className="truncate text-xs text-muted-foreground">{title}</div>
      </div>
    </NavLink>
  );
}
