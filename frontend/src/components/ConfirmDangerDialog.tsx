import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Type-to-confirm dialog for the irreversible actions, shared so two surfaces offering
 * the same delete cannot guard it differently. `error` renders inside the dialog: the
 * modal overlay covers a page-level banner, so a failure reported there is invisible.
 */
export function ConfirmDangerDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmWord,
  confirmLabel,
  pending = false,
  error = "",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Why this cannot be undone; should name what the user has to type. */
  description: ReactNode;
  /** Typed verbatim before the action unlocks — the repo name at both call sites. */
  confirmWord: string;
  confirmLabel: string;
  pending?: boolean;
  /** Failure from the last attempt. Shown here, not on the page behind. */
  error?: string;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");

  // A reopened dialog starts empty: the guard is only a guard if it has to be
  // passed again.
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  return (
    <Dialog
      open={open}
      // A request in flight owns the dialog: dismissing mid-delete leaves the user
      // with no idea whether it happened.
      onOpenChange={(next) => { if (!pending) onOpenChange(next); }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{description}</p>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={confirmWord}
          aria-label={`Type ${confirmWord} to confirm`}
          className="h-8 text-[0.8125rem]"
        />
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={typed !== confirmWord || pending}
            onClick={onConfirm}
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
