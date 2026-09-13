import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, Bug, Handshake, MessageCircle } from "lucide-react";
import { PublicPageShell } from "@/components/PublicPageShell";
import { Card, CardContent } from "@/components/ui/card";
import { copyToClipboard } from "@/lib/clipboard";
import { CONTACT } from "@/lib/contact";

/**
 * Public contact page. Its only job is to route a visitor to the right channel
 * in one click: questions go to GitHub Discussions, bugs to the issue tracker,
 * collaboration to Nam directly (email or LinkedIn). "Email Nam" copies the
 * address and confirms with a toast rather than opening mailto, because a
 * machine without a configured mail client turns mailto into a dead end; if
 * the copy fails, mailto is the fallback. Team credit is reduced to a one-line
 * attribution so nothing competes with the three channels.
 * Copy rule: no em dashes.
 */

const EMAIL_HREF = `mailto:${CONTACT.email}`;
const ISSUES_HREF = "https://github.com/KuanKongy/OnboardBuddy/issues/new";
const DISCUSSIONS_HREF = "https://github.com/KuanKongy/OnboardBuddy/discussions";

const ARROW_LINK =
  "inline-flex items-center gap-1 text-[0.8125rem] font-medium text-primary hover:underline";

const TOAST_MS = 2500;

/**
 * One channel: icon, heading, the single question that tells a visitor whether
 * this is their card, and the action row pinned to the card's floor so the
 * three rows align across the grid.
 */
function ChannelCard({
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

        <div className="mt-4 flex flex-1 flex-wrap items-end gap-x-4 gap-y-1">{children}</div>
      </CardContent>
    </Card>
  );
}

function ArrowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className={ARROW_LINK} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
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

  async function emailNam() {
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
      title="Contact"
      subtitle="Have a question, found a bug, or want to get in touch?"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <ChannelCard
          icon={<MessageCircle className="h-5 w-5" />}
          heading="Questions &amp; Feedback"
          body="Have feedback about OnboardBuddy or an idea for a feature?"
        >
          <ArrowLink href={DISCUSSIONS_HREF}>Start a discussion</ArrowLink>
        </ChannelCard>
        <ChannelCard
          icon={<Bug className="h-5 w-5" />}
          heading="Bug Report"
          body="Something isn't working as expected?"
        >
          <ArrowLink href={ISSUES_HREF}>Report an issue</ArrowLink>
        </ChannelCard>
        <ChannelCard
          icon={<Handshake className="h-5 w-5" />}
          heading="Collaboration"
          body="Interested in the project, contributing, or working together?"
        >
          <button type="button" onClick={emailNam} className={ARROW_LINK}>
            Email Nam
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <ArrowLink href={CONTACT.linkedin}>Contact Nam</ArrowLink>
        </ChannelCard>
      </div>

      {/* Team credit lives here, as a footnote rather than a section, so the
          three channels above stay the point of the page. */}
      <div className="mt-8 text-center">
        <p className="text-[0.875rem] font-medium text-foreground">OnboardBuddy</p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
          An independent project by the OnboardBuddies team, currently maintained by Nam Le.
        </p>
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[0.8125rem]">
          <a
            href={CONTACT.github}
            className="font-medium text-primary hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <span className="text-muted-foreground" aria-hidden="true">
            &middot;
          </span>
          <a
            href={CONTACT.linkedin}
            className="font-medium text-primary hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            LinkedIn
          </a>
          <span className="text-muted-foreground" aria-hidden="true">
            &middot;
          </span>
          <button
            type="button"
            onClick={emailNam}
            className="font-medium text-primary hover:underline"
          >
            Email
          </button>
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
