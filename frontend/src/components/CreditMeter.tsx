import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
// The contract and its formatters live in lib/credit.ts: Account Settings reads
// the same endpoint, and one mirror of the server shape cannot drift from two.
import { ca, resetsRelative, type Credit } from "@/lib/credit";
import { cn } from "@/lib/utils";

/**
 * A compact read of this month's analysis credit, for the analyze dialog. It
 * fails quiet: a loading or errored fetch renders nothing rather than a broken
 * bar, because this is a helpful aside next to the run button, not a gate on it
 * (the server enforces the real limit and the dialog surfaces its rejection).
 */
export function CreditMeter({ className }: { className?: string }) {
  const [credit, setCredit] = useState<Credit | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch("/me/credit")
      .then((data: Credit) => {
        if (live) setCredit(data);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // Quiet on both the pre-fetch and the failed-fetch states.
  if (failed || !credit) return null;

  const boxClass = cn(
    "rounded-md border border-border bg-muted/30 px-3 py-2 text-[0.71875rem] text-muted-foreground",
    className,
  );

  const unlimited = credit.tier === "dev" || credit.monthlyCredits === null;
  if (unlimited) {
    return <div className={boxClass}>Unlimited (dev)</div>;
  }

  const limit = credit.monthlyCredits as number;
  const pct = limit > 0 ? Math.min(100, Math.max(0, (credit.monthlyUsed / limit) * 100)) : 0;
  const exhausted = credit.monthlyUsed >= limit;

  // The pace line is a secondary aside, shown only when the rolling window is
  // the binding constraint (already rate-limited, or past halfway to the cap),
  // so the common month-has-room case stays a single clean line.
  const rateCap = credit.rateCredits;
  const showPace =
    rateCap !== null && rateCap > 0 && (credit.reason === "rate_limited" || credit.rateUsed >= rateCap * 0.5);

  return (
    <div className={boxClass}>
      <div className="flex items-baseline justify-between gap-2">
        <span>
          <span className="font-medium text-foreground">{ca(credit.monthlyUsed)}</span> of {limit} credits
          used this month
        </span>
        <span>resets {resetsRelative(credit.monthResetAt)}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className={cn("h-full rounded-full transition-all", exhausted ? "bg-danger" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showPace ? (
        <div className="mt-1.5">
          Pace: {ca(credit.rateUsed)} of {rateCap} this window
          {credit.rateResetAt ? `, next slot ${resetsRelative(credit.rateResetAt)}` : ""}
        </div>
      ) : null}
    </div>
  );
}
