/**
 * Single source of truth for public pricing copy and numbers.
 *
 * The landing convention is that numbers are imported, never retyped (see
 * CostSection's DEPTH_BUDGETS): the pricing page reads everything here so the
 * enforced facts on screen cannot drift from one card to the next. Two of the
 * facts per plan are actually enforced by the backend credit system, and they
 * are the only two shown as facts: the monthly credit allotment and the pace
 * (the rolling-window rate cap; see the /me/credit contract). A credit is CA$1
 * of analysis. The `features` list is marketing perks, and for Pro/Max those
 * are aspirational until the plans leave preview.
 *
 * The Dev tier is deliberately absent: it is an internal unlimited tier, never
 * shown to the public. Copy rule for this whole file: no em dashes.
 */

export interface Plan {
  id: "free" | "pro" | "max";
  name: string;
  /** Headline shown large on the card, e.g. "$0" or "In preview". */
  priceLabel: string;
  /** Small unit beside the headline, e.g. "/mo". Omitted when there is none. */
  pricePeriod?: string;
  tagline: string;
  /** Backend-enforced: analysis credits granted each month. A credit is CA$1. */
  monthlyCredits: string;
  /** Backend-enforced: the pace cap (rolling-window rate limit). */
  pace: string;
  /** Perks beyond the two enforced facts. Aspirational for the preview tiers. */
  features: string[];
  /**
   * Call to action. A `to` route makes it a link; `disabled` makes it a dead
   * button (Pro/Max have no checkout yet, so their CTA is a disabled label).
   */
  cta: { label: string; to?: string; disabled?: boolean };
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    priceLabel: "$0",
    pricePeriod: "/mo",
    tagline: "Try OnboardBuddy on a repo or two.",
    monthlyCredits: "5 credits / month",
    pace: "Up to 1 credit every 5 days",
    features: ["Standard analysis depth", "Community support"],
    cta: { label: "Get started", to: "/signup" },
  },
  {
    id: "pro",
    name: "Pro",
    priceLabel: "In preview",
    tagline: "For teams onboarding to a codebase regularly.",
    monthlyCredits: "30 credits / month",
    pace: "Up to 2 credits per day",
    features: [
      "Deeper default depth",
      "Private analyses",
      "Priority processing",
      "Larger repositories",
      "Faster support",
    ],
    cta: { label: "Coming soon", disabled: true },
  },
  {
    id: "max",
    name: "Max",
    priceLabel: "In preview",
    tagline: "For organizations that need scale and control.",
    monthlyCredits: "100 credits / month",
    pace: "Up to 5 credits per 12 hours",
    features: [
      "Everything in Pro",
      "Team seats",
      "SSO",
      "Custom model selection",
      "API access",
      "Dedicated support",
    ],
    cta: { label: "Coming soon", disabled: true },
  },
];
