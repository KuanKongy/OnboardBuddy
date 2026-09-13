import { cn } from "@/lib/utils";

const BLUE = "#2659f4";

export type LogoMarkVariant = "classic" | "wink" | "star";

/** Five-point star polygon centered on the given eye position. */
function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`);
  }
  return points.join(" ");
}

/**
 * The OnboardBuddy smiley mark. Navy parts render in `currentColor` so the
 * mark stays visible in dark mode (defaults to brand navy in light, white in
 * dark); the blue half is the fixed brand blue, which works on both grounds.
 *
 * Variants change only the eyes and exist for the pricing tiers: "classic"
 * everywhere, "wink" for Pro, "star" (starry-eyed) for Max.
 */
export function LogoMark({
  className,
  variant = "classic",
}: {
  className?: string;
  variant?: LogoMarkVariant;
}) {
  return (
    <svg
      viewBox="110 5 164 156"
      role="img"
      aria-label="OnboardBuddy logo"
      data-variant={variant}
      className={cn("h-7 w-7 text-[#0c1c3b] dark:text-white", className)}
    >
      {variant === "star" ? (
        <>
          <polygon points={starPoints(140, 41, 28, 12)} fill={BLUE} />
          <polygon points={starPoints(244, 40, 27, 11.5)} fill="currentColor" />
        </>
      ) : (
        <>
          <circle cx="140" cy="41" r="22" fill={BLUE} />
          {variant === "wink" ? (
            <path
              d="M225 48 Q244 27 263 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="14"
              strokeLinecap="round"
            />
          ) : (
            <circle cx="244" cy="40" r="21" fill="currentColor" />
          )}
        </>
      )}
      <path
        d="M249.4 83.1 A58 58 0 0 1 204.1 131.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="28"
        strokeLinecap="round"
      />
      <path
        d="M134.6 83.1 A58 58 0 0 0 198.1 132.7"
        fill="none"
        stroke={BLUE}
        strokeWidth="28"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Two-tone "OnboardBuddy" wordmark matching the brand logo. */
export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-sm font-semibold", className)}>
      <span className="text-foreground">Onboard</span>
      <span className="text-[#2659f4]">Buddy</span>
    </span>
  );
}
