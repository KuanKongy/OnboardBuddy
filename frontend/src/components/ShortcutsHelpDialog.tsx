import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ShortcutGroups = Array<{ group: string; rows: Array<{ keys: string[]; action: string }> }>;

/** The project keymap — rendered by the "?" overlay and the sidebar entry. */
const PROJECT_SHORTCUT_GROUPS: ShortcutGroups = [
  {
    group: "Anywhere in a project",
    rows: [
      { keys: ["↑"], action: "Previous tab" },
      { keys: ["↓"], action: "Next tab" },
      { keys: ["1", "…", "9"], action: "Jump to tab (Overview = 1 … Settings = 9)" },
      { keys: ["?"], action: "Show this overlay" },
    ],
  },
  {
    group: "Onboarding reader",
    rows: [
      { keys: ["←", "→"], action: "Previous / next section" },
    ],
  },
  {
    group: "Tutorials",
    rows: [
      { keys: ["←", "→"], action: "Previous / next step" },
    ],
  },
  {
    group: "Graphs (Dependencies, Architecture, Workflows)",
    rows: [
      { keys: ["←", "→"], action: "Cycle node selection (Dependencies & Classes)" },
      { keys: ["Esc"], action: "Deselect node / close the details panel" },
    ],
  },
];

/** The keymap for the main dashboard shell (dashboard / list / invitations / settings). */
const DASHBOARD_SHORTCUT_GROUPS: ShortcutGroups = [
  {
    group: "Anywhere in the dashboard",
    rows: [
      { keys: ["↑"], action: "Previous page" },
      { keys: ["↓"], action: "Next page" },
      { keys: ["1", "…", "5"], action: "Jump to page (Dashboard = 1 … Help & FAQ = 5)" },
      { keys: ["?"], action: "Show this overlay" },
    ],
  },
  {
    group: "Inside a project",
    rows: [
      { keys: ["↑", "↓"], action: "Cycle tabs, plus arrows, Esc and more (see ? there)" },
    ],
  },
];

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium text-foreground shadow-[0_1px_0_var(--border)]">
      {children}
    </kbd>
  );
}

export function ShortcutsHelpDialog({
  open,
  onOpenChange,
  context = "project",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which keymap to show — the project tabs one or the dashboard shell one. */
  context?: "project" | "dashboard";
}) {
  const SHORTCUT_GROUPS = context === "dashboard" ? DASHBOARD_SHORTCUT_GROUPS : PROJECT_SHORTCUT_GROUPS;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {SHORTCUT_GROUPS.map(({ group, rows }) => (
            <div key={group}>
              <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
              <div className="space-y-1">
                {rows.map(({ keys, action }) => (
                  <div key={action} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-foreground">{action}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {keys.map((k, i) =>
                        k === "…" ? <span key={i} className="text-muted-foreground">…</span> : <Key key={i}>{k}</Key>,
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[0.6875rem] text-muted-foreground">
            Shortcuts pause while you&apos;re typing or a dialog is open. Single-key shortcuts can be
            turned off entirely in{" "}
            <Link to="/settings" className="text-primary hover:underline" onClick={() => onOpenChange(false)}>
              Account settings → Preferences
            </Link>
            ; the buttons and links they duplicate keep working.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
