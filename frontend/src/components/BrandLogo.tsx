import { cn } from "@/lib/utils";

const BLUE = "#2659f4";

/**
 * The OnboardBuddy smiley mark. Navy parts render in `currentColor` so the
 * mark stays visible in dark mode (defaults to brand navy in light, white in
 * dark); the blue half is the fixed brand blue, which works on both grounds.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="110 5 164 156"
      role="img"
      aria-label="OnboardBuddy logo"
      className={cn("h-7 w-7 text-[#0c1c3b] dark:text-white", className)}
    >
      <circle cx="140" cy="41" r="22" fill={BLUE} />
      <circle cx="244" cy="40" r="21" fill="currentColor" />
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
