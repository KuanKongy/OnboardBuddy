/**
 * The one background behind the whole landing page: a masked dot grid and
 * three slow aurora blobs in the brand blue plus two categorical hues, with a
 * dark-only vignette for depth. Fixed so every section scrolls over the same
 * ground (the old page alternated bg-card bands with mismatched borders).
 *
 * Perf rules: the blobs are pre-blurred radial gradients (never filter:blur),
 * only transform animates, and the whole layer ignores the pointer. The
 * global reduced-motion rule freezes the drift.
 */
export function LivingBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.05] dark:opacity-[0.08]"
        style={{
          backgroundImage:
            "radial-gradient(color-mix(in oklab, var(--foreground) 60%, transparent) 1px, transparent 1.5px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse 95% 75% at 50% 0%, black 50%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 95% 75% at 50% 0%, black 50%, transparent 100%)",
        }}
      />
      <div
        className="animate-landing-drift absolute -top-48 left-[6%] h-[38rem] w-[38rem] rounded-full opacity-[0.13] will-change-transform dark:opacity-[0.20]"
        style={{
          background:
            "radial-gradient(closest-side, #2659f4 0%, color-mix(in oklab, #2659f4 55%, transparent) 40%, transparent 72%)",
        }}
      />
      <div
        className="animate-landing-drift-slow absolute right-[-8rem] top-[24rem] h-[34rem] w-[34rem] rounded-full opacity-[0.10] will-change-transform dark:opacity-[0.16]"
        style={{
          background: "radial-gradient(closest-side, var(--node-ui) 0%, transparent 70%)",
        }}
      />
      <div
        className="animate-landing-drift absolute bottom-[-12rem] left-[28%] h-[36rem] w-[36rem] rounded-full opacity-[0.08] will-change-transform dark:opacity-[0.14]"
        style={{
          background: "radial-gradient(closest-side, var(--node-state) 0%, transparent 70%)",
          animationDelay: "-18s",
        }}
      />
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
