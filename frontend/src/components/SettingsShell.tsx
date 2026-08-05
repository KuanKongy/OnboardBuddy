import { useEffect, useRef, useState, type ReactNode } from "react";
import { scrollBehavior } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SettingsSection {
  id: string;
  label: string;
  children: ReactNode;
}

/**
 * Shared layout for the settings pages: a section rail beside one readable
 * column, styled like the onboarding reader. From `lg` up the page itself does
 * not scroll — the rail is a fixed column and the content column is the only
 * scroll port, so the rail and any error banner above the shell stay on screen.
 * Below `lg` the rail is a chip row in flow and the shell's `<main>` scrolls,
 * as before. Each section's `h2` is also the heading level the card `h3`s nest
 * under.
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
  /** Page-level actions (e.g. Save/Cancel) — rendered on the column's measure,
   *  after the last section. */
  footer?: ReactNode;
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const clickedAtRef = useRef(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
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
    <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:flex-row">
        {/* No `sticky`: from lg up the rail is a fixed column of the page frame
            and has nothing to travel against. Below lg the chip row carries its
            own inset and divider — `<main>` is full-bleed here, so nothing else
            would hold the chips off the window wall. */}
        <nav
          aria-label="Settings sections"
          className="border-b px-3 py-2 sm:px-4 lg:w-40 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:py-3 lg:pl-5 lg:pr-2"
        >
          <div className="flex flex-wrap gap-1 lg:block lg:space-y-0.5">
            <p className="section-label hidden pb-1 lg:block">Sections</p>
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-current={active === section.id ? "true" : undefined}
                onClick={() => {
                  clickedAtRef.current = Date.now();
                  setActive(section.id);
                  const el = document.getElementById(section.id);
                  const scroller = scrollerRef.current;
                  // Desktop scrolls the column by hand. `scrollIntoView` targets no
                  // container: it walks every ancestor, including the app shell's
                  // `overflow-hidden` box, and stranded a scroll offset there that
                  // no scrollbar could undo. Rect math (not offsetTop) because the
                  // sections are not positioned against the scroller.
                  // scrollBehavior(), not "smooth": an explicit behavior outranks the
                  // reduced-motion reset in styles.css.
                  if (el && scroller && window.matchMedia("(min-width: 1024px)").matches) {
                    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8;
                    scroller.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior() });
                  } else {
                    el?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
                  }
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

        {/* `overflow-y-scroll` + a stable gutter, not `auto`: this column is the
            only scroll port on the page, and with `auto` the track appears the
            moment the content grows past the viewport, shifting the centered
            measure sideways. Best effort only — macOS's "show scroll bars: when
            scrolling" still hides the thumb until you scroll, so the affordance
            there is the reserved gutter, not a visible bar. */}
        <div ref={scrollerRef} className="min-w-0 flex-1 lg:overflow-y-scroll lg:overscroll-contain lg:[scrollbar-gutter:stable]">
          {/* Centered measure, like the reader's column: it sits mid-pane while
              max-w-3xl still caps the line length. */}
          <div className="mx-auto max-w-3xl space-y-6 px-3 py-4 sm:px-4 lg:px-8 lg:py-5">
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-heading`}
                className="scroll-mt-6 space-y-3"
              >
                <h2 id={`${section.id}-heading`} className="text-[1.0625rem] font-semibold tracking-tight text-foreground">
                  {section.label}
                </h2>
                {section.children}
              </section>
            ))}
            {footer && <div>{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
