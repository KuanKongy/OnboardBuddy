import { Link } from "react-router-dom";
import { PublicPageShell } from "@/components/PublicPageShell";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Plain-language terms for an independent project: honest about what the
 * service is, what users promise, and what nobody should rely on. Public by
 * design, linked from the landing footer. Copy rule: no em dashes.
 */

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24">
      <Card>
        <CardContent className="p-5">
          <h2 id={`${id}-h`} className="text-sm font-semibold text-foreground">
            {title}
          </h2>
          <div className="mt-2 space-y-2.5 text-[0.875rem] leading-relaxed text-muted-foreground">
            {children}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

export function TermsPage() {
  return (
    <PublicPageShell
      title="Terms of Service"
      subtitle="Plain-language terms for using OnboardBuddy."
    >
      <div className="space-y-4">
        <Section id="service" title="What OnboardBuddy is">
          <p>
            OnboardBuddy analyzes a GitHub repository you connect and generates onboarding
            documentation from it: a role-based handbook, dependency and architecture maps, traced
            workflows, and tutorials, with every claim cited to the code it came from. It is built
            and operated by a small independent team; there is no company behind it.
          </p>
        </Section>

        <Section id="accounts" title="Your account">
          <p>
            You sign in with an email and password or with GitHub, and you are responsible for
            activity under your account. Keep your credentials to yourself; there is no way for
            the team to verify who is behind a session.
          </p>
        </Section>

        <Section id="repos" title="Repositories you connect">
          <p>
            Connect only repositories you own or have the right to share for analysis. Installing
            the GitHub App on an organization's repositories means you are authorized to do so.
            Access is read-only and limited to the repositories you select; see the{" "}
            <Link to="/privacy" className="text-primary hover:underline">
              privacy page
            </Link>{" "}
            for exactly what is read, sent, and stored.
          </p>
        </Section>

        <Section id="ai" title="AI-generated content">
          <p>
            Handbooks, tutorials, and answers are generated with the help of large language
            models. Every claim carries a citation so it can be checked, and unsupported answers
            are stated as unknowns, but generated text can still be incomplete or wrong. Review
            before relying on it, especially for anything security-sensitive or destructive.
          </p>
        </Section>

        <Section id="acceptable" title="Acceptable use">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>No analyzing code you have no right to access or share.</li>
            <li>No attempts to extract other users' data, probe the service's security, or disrupt its operation.</li>
            <li>No use of the service to generate or distribute malicious code.</li>
          </ul>
        </Section>

        <Section id="ip" title="Ownership">
          <p>
            Your code stays yours; connecting a repository grants OnboardBuddy only the limited
            read access needed to analyze it. Generated documentation belongs to the project it
            was generated for and is shared with that project's members. The OnboardBuddy
            software, name, and design remain the team's.
          </p>
        </Section>

        <Section id="availability" title="Availability and warranty">
          <p>
            OnboardBuddy is provided as is, without warranties of any kind, as an independent
            project. It may be unavailable, rate-limited, changed, or shut down at any time.
            Export anything you want to keep; the handbook export exists for exactly that. To
            the extent the law allows, the team is not liable for damages arising from use of
            the service.
          </p>
        </Section>

        <Section id="termination" title="Ending things">
          <p>
            You can stop at any time: uninstall the GitHub App to cut repository access, delete
            individual projects, or delete your account, which permanently removes your profile
            and every project you own. The team may suspend accounts that break these terms.
          </p>
        </Section>

        <Section id="changes" title="Changes to these terms">
          <p>
            These terms may change as the project evolves; the current version always lives at
            this address. Continued use after a change means the new terms apply.
          </p>
        </Section>
      </div>
    </PublicPageShell>
  );
}
