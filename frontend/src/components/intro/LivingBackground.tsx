/**
 * The one background behind the whole landing page: a masked dot grid and
 * three slow aurora blobs in the brand blue plus two categorical hues, with a
 * vignette for depth. Fixed so every section scrolls over the same ground (the
 * old page alternated bg-card bands with mismatched borders).
 *
 * The dot grid and the vignette are the base mesh; they render everywhere.
 * The three colored blobs are gated behind `showLights` so the public content
 * pages (via PublicPageShell) get the calm base mesh without the aurora, while
 * the landing page keeps the full effect.
 *
 * Light theme is a genuinely lighter version of the intro, not flat white: the
 * base opacities are lifted enough to read on white, and the bottom vignette
 * renders in both themes (a --foreground tint in light, the darker black in
 * dark) so the bottom edge is grounded rather than washing out.
 *
 * Perf rules: the blobs are pre-blurred radial gradients (never filter:blur),
 * only transform animates, and the whole layer ignores the pointer. The
 * global reduced-motion rule freezes the drift.
 */
export function LivingBackground({ showLights = true }: { showLights?: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.07] dark:opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(color-mix(in oklab, var(--foreground) 60%, transparent) 1px, transparent 1.5px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse 95% 75% at 50% 0%, black 50%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 95% 75% at 50% 0%, black 50%, transparent 100%)",
        }}
      />
      {showLights ? (
        <>
          <div
            data-testid="aurora-blob"
            className="animate-landing-drift absolute -top-48 left-[6%] h-[38rem] w-[38rem] rounded-full opacity-[0.16] will-change-transform dark:opacity-[0.20]"
            style={{
              background:
                "radial-gradient(closest-side, #2659f4 0%, color-mix(in oklab, #2659f4 55%, transparent) 40%, transparent 72%)",
            }}
          />
          <div
            data-testid="aurora-blob"
            className="animate-landing-drift-slow absolute right-[-8rem] top-[24rem] h-[34rem] w-[34rem] rounded-full opacity-[0.13] will-change-transform dark:opacity-[0.16]"
            style={{
              background: "radial-gradient(closest-side, var(--node-ui) 0%, transparent 70%)",
            }}
          />
          <div
            data-testid="aurora-blob"
            className="animate-landing-drift absolute bottom-[-12rem] left-[28%] h-[36rem] w-[36rem] rounded-full opacity-[0.11] will-change-transform dark:opacity-[0.14]"
            style={{
              background: "radial-gradient(closest-side, var(--node-state) 0%, transparent 70%)",
              animationDelay: "-18s",
            }}
          />
        </>
      ) : null}
      {/* Bottom vignette, light variant: a --foreground tint (not pure black)
          so light theme has a grounded darker edge instead of fading to white. */}
      <div
        className="absolute inset-0 dark:hidden"
        style={{
          background:
            "radial-gradient(ellipse 120% 90% at 50% -10%, transparent 55%, color-mix(in oklch, var(--foreground) 10%, transparent) 100%)",
        }}
      />
      {/* Bottom vignette, dark variant: unchanged. */}
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          background:
            "radial-gradient(ellipse 120% 90% at 50% -10%, transparent 55%, color-mix(in oklab, black 45%, transparent) 100%)",
        }}
      />
    </div>
  );
}
