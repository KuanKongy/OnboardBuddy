import { useEffect, useRef, useState, type ReactNode } from "react";
import { scrollBehavior } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SettingsSection {
  id: string;
  label: string;
  children: ReactNode;
}

/**
 * Shared layout for the settings pages: a sticky section rail beside one
 * readable column, centered together as a group. Each section's `h2` is also
 * the heading level the card `h3`s nest under.
 *
 * The rail highlight is scroll-driven (IntersectionObserver over the section
 * elements), so it stays correct even when a short last section cannot
 * physically reach the top of the scroll port. Clicking still scrolls; the
 * spy pauses briefly during the glide so the highlight does not flicker
 * through the sections passing by. jsdom has no IntersectionObserver; there
 * the highlight stays click-driven.
 */
export function SettingsShell({
  sections,
  footer,
}: {
  sections: SettingsSection[];
  /** Page-level actions (e.g. Save/Cancel) — kept on the column's measure. */
  footer?: ReactNode;
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const clickedAtRef = useRef(0);
  // The pages build `sections` inline every render; key the observer on the
  // id set (e.g. the owner-only Danger zone appearing) rather than identity.
  const sectionIdsKey = sections.map((section) => section.id).join("|");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = sectionIdsKey
      .split("|")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() - clickedAtRef.current < 800) return;
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setActive(top.target.id);
      },
      // Top band of the scroll port: the section under the upper edge wins.
      { rootMargin: "-8px 0px -65% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sectionIdsKey]);

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-start">
      <nav aria-label="Settings sections">
        <div className="sticky top-4 flex flex-wrap gap-1 lg:block lg:space-y-0.5">
          <p className="section-label hidden pb-1 lg:block">Sections</p>
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              aria-current={active === section.id ? "true" : undefined}
              onClick={() => {
                clickedAtRef.current = Date.now();
                setActive(section.id);
                // scrollBehavior(), not "smooth": an explicit behavior outranks the
                // reduced-motion reset in styles.css.
                document.getElementById(section.id)?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
              }}
              className={cn(
                "truncate rounded px-2 py-1 text-left text-[0.6875rem] transition-colors lg:block lg:w-full",
                active === section.id
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {section.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="min-w-0 max-w-3xl space-y-6">
        {sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-heading`}
            className="scroll-mt-6 space-y-3"
          >
            <h2 id={`${section.id}-heading`} className="text-sm font-semibold tracking-tight text-foreground">
              {section.label}
            </h2>
            {section.children}
          </section>
        ))}
        {footer}
      </div>
    </div>
  );
}
