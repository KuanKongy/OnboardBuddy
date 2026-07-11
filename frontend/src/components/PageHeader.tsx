import type { ReactNode } from "react";
import { SidebarToggle } from "@/components/SidebarShell";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Rendered between the sidebar toggle and the title block (e.g. a breadcrumb back button). */
  leading?: ReactNode;
  /** Right-aligned header controls. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Standard page header: sidebar toggle + title/subtitle on the left, actions
 * on the right. The toggle lives inside the header row (not a row of its own)
 * so opening/closing the sidebar never shifts the page content vertically.
 */
export function PageHeader({ title, subtitle, leading, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("page-header", className)}>
      <div className="flex min-w-0 items-start gap-2">
        <SidebarToggle className="mt-0.5 shrink-0" />
        {leading}
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {subtitle ? <div className="page-subtitle">{subtitle}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
