import { useState, type ReactNode } from "react";
import { Check, Copy, Github, Linkedin, Mail, X } from "lucide-react";
import { PublicPageShell } from "@/components/PublicPageShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CONTACT } from "@/lib/contact";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/**
 * About / Contact. Team framing only, not product mechanics: OnboardBuddy is an
 * independent project maintained by Nam Le, credited alongside the rest of the
 * OnboardBuddies team. Nam is the one point of contact, so only his card carries
 * contact pills. Copy rule: no em dashes.
 */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="scroll-mt-24">
      <Card>
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <div className="mt-2 space-y-2.5 text-[0.875rem] leading-relaxed text-muted-foreground">
            {children}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * One copy-to-clipboard contact detail. The icon swaps Copy -> Check on a
 * successful copy (and -> X on the rare failure), mirroring NodeInfoPanel's
 * copy button, then reverts after a moment. The width is controlled by the
 * caller so the pills can sit side by side in a row.
 */
function ContactPill({
  icon,
  label,
  value,
  className,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleCopy() {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      setFailed(true);
      setTimeout(() => setFailed(false), 1500);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-left text-[0.8125rem] transition-colors hover:border-[#2659f4]/30 hover:bg-accent/50",
        className,
      )}
    >
      <span className="shrink-0 text-muted-foreground" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{value}</span>
      {failed ? (
        <X className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
      ) : copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </button>
  );
}

/** The rest of the team, credited by name. No roles, no contact of their own. */
const TEAM = ["Eugene N.", "Sahib R.", "Bradley S."];

export function ContactPage() {
  return (
    <PublicPageShell
      title="About & Contact"
      subtitle="Who builds OnboardBuddy, and how to get in touch."
    >
      <div className="space-y-4">
        {/* Lead: a plain description, no heading. Team framing only. */}
        <Card>
          <CardContent className="p-5 text-[0.875rem] leading-relaxed text-muted-foreground">
            <p>
              OnboardBuddy is an independent project with no company behind it. It is built by the
              OnboardBuddies team and maintained by Nam Le.
            </p>
          </CardContent>
        </Card>

        <Section title="The OnboardBuddies team">
          {/* Nam: the maintainer, with the only contact pills on the page. */}
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-[0.875rem] font-medium text-foreground">Nam Le</span>
              <Badge variant="secondary">Maintainer</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <ContactPill
                icon={<Mail className="h-4 w-4" />}
                label="email"
                value={CONTACT.email}
                className="min-w-0 flex-1 basis-[13rem]"
              />
              <ContactPill
                icon={<Linkedin className="h-4 w-4" />}
                label="LinkedIn"
                value={CONTACT.linkedin}
                className="min-w-0 flex-1 basis-[13rem]"
              />
              <ContactPill
                icon={<Github className="h-4 w-4" />}
                label="GitHub"
                value={CONTACT.github}
                className="min-w-0 flex-1 basis-[13rem]"
              />
            </div>
          </div>

          {/* The rest of the team, credited by name only. */}
          <ul className="mt-1 list-none space-y-1.5 pl-0">
            {TEAM.map((member) => (
              <li key={member} className="text-[0.875rem] text-foreground">
                {member}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </PublicPageShell>
  );
}
