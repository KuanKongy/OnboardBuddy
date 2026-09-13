import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, Github, Linkedin, Mail } from "lucide-react";
import { PublicPageShell } from "@/components/PublicPageShell";
import { Card, CardContent } from "@/components/ui/card";
import { copyToClipboard } from "@/lib/clipboard";
import { CONTACT } from "@/lib/contact";

/**
 * Public contact page: three actual destinations (the GitHub repo, Nam's
 * LinkedIn, and email), not abstract channels. "Send an email" copies the
 * address and confirms with a toast rather than opening mailto, because a
 * machine without a configured mail client turns mailto into a dead end; if
 * the copy fails, mailto is the fallback. Team credit is one footer line.
 * Copy rule: no em dashes.
 */

const EMAIL_HREF = `mailto:${CONTACT.email}`;
const REPO_HREF = "https://github.com/KuanKongy/OnboardBuddy";

const ARROW_LINK =
  "inline-flex items-center gap-1 text-[0.8125rem] font-medium text-primary hover:underline";

const TOAST_MS = 2500;

/**
 * One destination: icon, name, what belongs there, and the action pinned to
 * the card's floor so the three actions align across the grid.
 */
function DestinationCard({
  icon,
  heading,
  body,
  children,
}: {
  icon: ReactNode;
  heading: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <Card className="h-full transition-colors duration-300 hover:border-[#2659f4]/30">
      <CardContent className="flex h-full flex-col p-5">
        <span className="text-[#2659f4]" aria-hidden="true">
          {icon}
        </span>

        <h2 className="mt-3 text-base font-semibold text-foreground">{heading}</h2>
        <p className="mt-1 text-[0.875rem] leading-relaxed text-muted-foreground">{body}</p>

        <div className="mt-4 flex flex-1 items-end">{children}</div>
      </CardContent>
    </Card>
  );
}

export function ContactPage() {
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  async function sendEmail() {
    if (!(await copyToClipboard(CONTACT.email))) {
      window.location.href = EMAIL_HREF;
      return;
    }
    setToast("Email copied to clipboard");
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }

  return (
    <PublicPageShell
      title="Get in touch"
      subtitle="Found a bug, have an idea, or want to talk about OnboardBuddy?"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <DestinationCard
          icon={<Github className="h-5 w-5" />}
          heading="GitHub"
          body="Follow development, browse the source, open an issue, or contribute."
        >
          <a href={REPO_HREF} className={ARROW_LINK} target="_blank" rel="noopener noreferrer">
            View on GitHub
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </DestinationCard>
        <DestinationCard
          icon={<Linkedin className="h-5 w-5" />}
          heading="LinkedIn"
          body="Connect with Nam and follow the person behind the project."
        >
          <a
            href={CONTACT.linkedin}
            className={ARROW_LINK}
            target="_blank"
            rel="noopener noreferrer"
          >
            Connect on LinkedIn
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </DestinationCard>
        <DestinationCard
          icon={<Mail className="h-5 w-5" />}
          heading="Email"
          body="For anything that doesn't fit GitHub: questions, feedback, or collaboration."
        >
          <button type="button" onClick={sendEmail} className={ARROW_LINK}>
            Send an email
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </DestinationCard>
      </div>

      {/* Team credit lives here, as a footnote rather than a section, so the
          three destinations above stay the point of the page. */}
      <div className="mt-8 text-center">
        <p className="text-[0.875rem] font-medium text-foreground">OnboardBuddy</p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
          An independent project by the OnboardBuddies team, maintained by Nam Le.
        </p>
      </div>

      {/* Always-mounted live region so the copy confirmation is announced. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center"
      >
        {toast ? (
          <span className="rounded-full border border-border bg-card px-4 py-2 text-[0.8125rem] font-medium text-foreground shadow-lg">
            {toast}
          </span>
        ) : null}
      </div>
    </PublicPageShell>
  );
}
