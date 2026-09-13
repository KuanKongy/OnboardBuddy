import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, Github, Linkedin, Mail, X } from "lucide-react";
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
/** Must match the transition duration on the toast so unmount waits for the fade. */
const TOAST_FADE_MS = 300;

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
  // The toast keeps its message mounted through the exit fade: `visible`
  // drives the CSS transition, `toast` drives mounting, and the unmount waits
  // TOAST_FADE_MS after `visible` drops so the fade-out is seen, not cut.
  const [toast, setToast] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }

  useEffect(() => clearTimers, []);

  function hideToast() {
    clearTimers();
    setToastVisible(false);
    timers.current.push(window.setTimeout(() => setToast(null), TOAST_FADE_MS));
  }

  async function sendEmail() {
    if (!(await copyToClipboard(CONTACT.email))) {
      window.location.href = EMAIL_HREF;
      return;
    }
    clearTimers();
    setToast("Email copied to clipboard");
    // One tick between mounting (hidden) and showing, so the entrance
    // transitions instead of popping.
    timers.current.push(window.setTimeout(() => setToastVisible(true), 20));
    timers.current.push(window.setTimeout(hideToast, TOAST_MS));
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

      {/* Always-mounted live region so the copy confirmation is announced.
          Bottom-right in the brand primary blue (theme-aware, same as the
          buttons), fading and sliding in and out; the X dismisses early. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6"
      >
        {toast ? (
          <div
            className={`pointer-events-auto flex items-center gap-1.5 rounded-lg bg-primary py-2.5 pl-5 pr-2.5 text-sm font-semibold text-primary-foreground shadow-lg transition-all duration-300 motion-reduce:transition-none ${
              toastVisible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            }`}
          >
            {toast}
            <button
              type="button"
              onClick={hideToast}
              aria-label="Dismiss"
              className="cursor-pointer rounded-md p-1 opacity-80 transition-colors hover:bg-primary-foreground/15 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/60"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </PublicPageShell>
  );
}
