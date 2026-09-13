import { Check, Gauge, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
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

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <Card className="h-full transition-colors duration-300 hover:border-[#2659f4]/30">
      <CardContent className="flex h-full flex-col p-6">
        <h2 className="text-base font-semibold text-foreground">{plan.name}</h2>

        <div className="mt-3 flex items-baseline gap-1">
          <span className="text-2xl font-semibold tracking-tight text-foreground">{plan.priceLabel}</span>
          {plan.pricePeriod ? (
            <span className="text-sm text-muted-foreground">{plan.pricePeriod}</span>
          ) : null}
        </div>
        <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">{plan.tagline}</p>

        {/* The two backend-enforced facts, set apart from the marketing perks:
            the monthly credit allotment and the pace (the rate cap). */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-foreground/10 px-3 py-2 dark:border-white/10">
            <Wallet className="h-4 w-4 shrink-0 text-[#2659f4]" aria-hidden="true" />
            <span className="text-[0.8125rem] font-medium text-foreground">{plan.monthlyCredits}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-foreground/10 px-3 py-2 dark:border-white/10">
            <Gauge className="h-4 w-4 shrink-0 text-[#2659f4]" aria-hidden="true" />
            <span className="text-[0.8125rem] font-medium text-foreground">{plan.pace}</span>
          </div>
        </div>

        <ul className="mt-4 space-y-2 text-[0.8125rem] text-muted-foreground">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 pt-2">
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
