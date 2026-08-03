import type { ReactNode } from "react";

/** One icon and one sentence; the guarantee-list row used by the privacy and
 *  cost sections. */
export function IconRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-primary">{icon}</span>
      <span className="text-[0.875rem] leading-relaxed text-muted-foreground">{children}</span>
    </li>
  );
}
