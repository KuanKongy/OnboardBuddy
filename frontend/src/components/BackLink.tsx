import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BackLinkProps {
  to?: string;
  label?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * Consistent "Back to dashboard" affordance used across top-level and deep
 * pages. Renders a discoverable, comfortably-sized ghost button that grows a
 * border on hover so it reads as clickable, while keeping the dense sizing
 * idiom (size="xs").
 */
export function BackLink({
  to = "/dashboard",
  label = "Back to dashboard",
  onClick,
  className,
}: BackLinkProps) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn(
        "gap-1.5 border border-transparent text-muted-foreground hover:border-border hover:text-foreground",
        className,
      )}
      asChild
    >
      <Link to={to} onClick={onClick}>
        <ArrowLeft className="h-3 w-3" />
        {label}
      </Link>
    </Button>
  );
}
