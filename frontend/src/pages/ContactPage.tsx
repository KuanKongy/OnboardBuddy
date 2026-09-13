import type { ReactNode } from "react";
import { ArrowRight, Bug, Handshake, MessageCircle } from "lucide-react";
import { PublicPageShell } from "@/components/PublicPageShell";
import { Card, CardContent } from "@/components/ui/card";
import { CONTACT } from "@/lib/contact";

/**
 * Public contact page. Its only job is to route a visitor to the right channel
 * in one click: feedback and collaboration go to Nam's inbox, bugs go to the
 * GitHub issue tracker. Team credit is reduced to a one-line attribution, so
 * nothing here competes with the three channels. Copy rule: no em dashes.
 */

/**
 * Every mail link is derived from the one published address in lib/contact, so
 * the address appears once and the subject lines stay per-channel.
 */
const EMAIL_HREF = `mailto:${CONTACT.email}`;
const FEEDBACK_HREF = `${EMAIL_HREF}?subject=OnboardBuddy%20feedback`;
const COLLABORATION_HREF = `${EMAIL_HREF}?subject=OnboardBuddy%20collaboration`;
const ISSUES_HREF = "https://github.com/KuanKongy/OnboardBuddy/issues/new";

/** Attribution footer links. Off-site ones open in a new tab. */
const ATTRIBUTION_LINKS = [
  { label: "GitHub", href: CONTACT.github, external: true },
  { label: "LinkedIn", href: CONTACT.linkedin, external: true },
  { label: "Email", href: EMAIL_HREF, external: false },
];

const ARROW_LINK =
  "inline-flex items-center gap-1 text-[0.8125rem] font-medium text-primary hover:underline";

/**
 * One channel: icon, heading, the single question that tells a visitor whether
 * this is their card, and the link that acts on it. External links get the
 * new-tab treatment; mailto links stay in place so the mail client takes over.
 */
function ChannelCard({
  icon,
  heading,
  body,
  linkText,
  href,
  external = false,
}: {
  icon: ReactNode;
  heading: string;
  body: string;
  linkText: string;
  href: string;
  external?: boolean;
}) {
  return (
    <Card className="h-full transition-colors duration-300 hover:border-[#2659f4]/30">
      <CardContent className="flex h-full flex-col p-5">
        <span className="text-[#2659f4]" aria-hidden="true">
          {icon}
        </span>

        <h2 className="mt-3 text-base font-semibold text-foreground">{heading}</h2>
        <p className="mt-1 text-[0.875rem] leading-relaxed text-muted-foreground">{body}</p>

        {/* Pushed to the card's floor so the three links align across the row. */}
        <div className="mt-4 flex flex-1 items-end">
          <a
            href={href}
            className={ARROW_LINK}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {linkText}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

export function ContactPage() {
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
          linkText="Email us"
          href={FEEDBACK_HREF}
        />
        <ChannelCard
          icon={<Bug className="h-5 w-5" />}
          heading="Bug Report"
          body="Something isn't working as expected?"
          linkText="Report an issue"
          href={ISSUES_HREF}
          external
        />
        <ChannelCard
          icon={<Handshake className="h-5 w-5" />}
          heading="Collaboration"
          body="Interested in the project, contributing, or working together?"
          linkText="Contact Nam"
          href={COLLABORATION_HREF}
        />
      </div>

      {/* Team credit lives here, as a footnote rather than a section, so the
          three channels above stay the point of the page. */}
      <div className="mt-8 text-center">
        <p className="text-[0.875rem] font-medium text-foreground">OnboardBuddy</p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
          An independent project by the OnboardBuddies team, currently maintained by Nam Le.
        </p>
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[0.8125rem]">
          {ATTRIBUTION_LINKS.map((link, index) => (
            <span key={link.label} className="inline-flex items-center gap-x-2">
              {index > 0 ? (
                <span className="text-muted-foreground" aria-hidden="true">
                  &middot;
                </span>
              ) : null}
              <a
                href={link.href}
                className="font-medium text-primary hover:underline"
                {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                {link.label}
              </a>
            </span>
          ))}
        </p>
      </div>
    </PublicPageShell>
  );
}
