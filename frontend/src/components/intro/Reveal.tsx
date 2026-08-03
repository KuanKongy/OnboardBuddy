import type { CSSProperties, ReactNode } from "react";
import { useInView } from "@/hooks/useInView";
import { cn } from "@/lib/utils";

/**
 * Fades content up once it scrolls into view; `index` staggers siblings via
 * the --reveal-i transition delay (styles.css). Reduced motion collapses the
 * transition to an instant appearance, and jsdom renders everything revealed.
 */
export function Reveal({
  children,
  className,
  index = 0,
}: {
  children: ReactNode;
  className?: string;
  index?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={cn("reveal", inView && "reveal-in", className)}
      style={{ "--reveal-i": index } as CSSProperties}
    >
      {children}
    </div>
  );
}
