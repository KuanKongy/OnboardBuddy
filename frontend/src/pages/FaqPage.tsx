import { Link } from "react-router-dom";
import { FAQ_ITEMS, FaqSection } from "@/components/FaqContent";
import { PublicPageShell } from "@/components/PublicPageShell";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The FAQ, public by design: the landing page links here and signed-out /help
 * redirects here (see `HelpRoute` in App.tsx). Same answers a signed-in reader
 * gets on the Help tab, minus the tour launcher, which needs a session and a
 * project. Nothing here fetches: a visitor without an account would only earn a
 * 401 in their console. Copy rule: no em dashes.
 */
export function FaqPage() {
  return (
    <PublicPageShell
      title="FAQ"
      subtitle="What OnboardBuddy does, what it sends to the AI, and how the output stays honest."
    >
      <Card>
        <CardContent className="p-5">
          <FaqSection items={FAQ_ITEMS} />
        </CardContent>
      </Card>
      <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
        The full policy lives on the{" "}
        <Link to="/privacy" className="text-primary hover:underline">
          Privacy Policy
        </Link>{" "}
        page. Guided tours and help scoped to your own projects live inside the app, under Help
        &amp; FAQ.
      </p>
    </PublicPageShell>
  );
}
