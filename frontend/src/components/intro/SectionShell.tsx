import type { ReactNode } from "react";
import { Reveal } from "@/components/intro/Reveal";
import { cn } from "@/lib/utils";

/**
 * One container width, one vertical rhythm, and a heading wired to the
 * section landmark, for every landing section. The continuous LivingBackground
 * replaced the old alternating bg-card bands, so sections separate by spacing
 * alone and the page ground never changes. scroll-mt keeps anchor jumps clear
 * of the sticky header.
 */
export function SectionShell({
  id,
  eyebrow,
  title,
  deck,
  children,
  className,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  deck?: string;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn("scroll-mt-24 px-4 py-20 sm:px-6 sm:py-24", className)}
    >
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          {eyebrow ? <p className="section-label mb-3 tracking-[0.14em] text-primary">{eyebrow}</p> : null}
          <h2 id={headingId} className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {title}
          </h2>
          {deck ? (
            <p className="mx-auto mt-3 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-muted-foreground">
              {deck}
            </p>
          ) : null}
        </Reveal>
        <div className="mt-10 sm:mt-12">{children}</div>
      </div>
    </section>
  );
}
