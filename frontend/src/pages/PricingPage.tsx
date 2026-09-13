import { Check, Gauge, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { LogoMark, type LogoMarkVariant } from "@/components/BrandLogo";
import { PublicPageShell } from "@/components/PublicPageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PLANS, type Plan } from "@/lib/plans";

/**
 * Public pricing. Every number and label comes from lib/plans.ts so the
 * enforced facts cannot drift; there is no checkout anywhere on this page. The
 * two facts shown per plan are the only ones the backend actually enforces:
 * the monthly credit allotment and the pace. Pro and Max are not sellable yet,
 * so their CTA is a disabled "Coming soon" with no link.
 * Copy rule: no em dashes.
 */

/**
 * The enforced-fact boxes sit side by side across three cards, so they need a
 * fixed floor: "Up to 2 credits per day" fits one line at desktop width while
 * the other two paces wrap to two, which otherwise left Pro's box shorter than
 * its neighbours. 3.75rem clears a measured two-line box (57px in Chromium) with
 * a little slack for other font metrics, and centred content keeps the
 * single-line case looking deliberate on a phone.
 */
const FACT_BOX =
  "flex min-h-[3.75rem] items-center gap-2 rounded-lg border border-foreground/10 px-3 py-2 dark:border-white/10";

/** The smiley works harder as the tier rises: neutral, wink, starry-eyed. */
const MARK_VARIANT: Record<Plan["id"], LogoMarkVariant> = {
  free: "classic",
  pro: "wink",
  max: "star",
};

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <Card className="h-full transition-colors duration-300 hover:border-[#2659f4]/30">
      <CardContent className="flex h-full flex-col p-6">
        {/* Decorative: the mark repeats on every card, so it is hidden from
            assistive tech rather than read out three times. */}
        <span aria-hidden="true">
          <LogoMark className="h-7 w-7" variant={MARK_VARIANT[plan.id]} />
        </span>

        <h2 className="mt-4 text-base font-semibold text-foreground">{plan.name}</h2>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">{plan.tagline}</p>

        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight text-foreground">{plan.priceLabel}</span>
          {plan.pricePeriod ? (
            <span className="text-sm text-muted-foreground">{plan.pricePeriod}</span>
          ) : null}
        </div>

        <div className="mt-5">
          {plan.cta.disabled ? (
            <Button className="w-full" variant="outline" disabled>
              {plan.cta.label}
            </Button>
          ) : (
            <Button asChild className="w-full">
              <Link to={plan.cta.to as string}>{plan.cta.label}</Link>
            </Button>
          )}
        </div>

        {/* The two backend-enforced facts, set apart from the marketing perks:
            the monthly credit allotment and the pace (the rate cap). */}
        <div className="mt-6 space-y-2 border-t border-foreground/10 pt-6 dark:border-white/10">
          <div className={FACT_BOX}>
            <Wallet className="h-4 w-4 shrink-0 text-[#2659f4]" aria-hidden="true" />
            <span className="text-[0.8125rem] font-medium text-foreground">{plan.monthlyCredits}</span>
          </div>
          <div className={FACT_BOX}>
            <Gauge className="h-4 w-4 shrink-0 text-[#2659f4]" aria-hidden="true" />
            <span className="text-[0.8125rem] font-medium text-foreground">{plan.pace}</span>
          </div>
        </div>

        {plan.featuresHeading ? (
          <p className="mt-5 text-[0.8125rem] font-medium text-foreground">{plan.featuresHeading}</p>
        ) : null}

        <ul className="mt-3 space-y-2 text-[0.8125rem] text-muted-foreground">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function PricingPage() {
  return (
    <PublicPageShell
      title="Pricing"
      subtitle="Monthly analysis credits and a steady pace, per plan. Start free."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">1 credit = CA$1 of analysis.</p>
    </PublicPageShell>
  );
}
