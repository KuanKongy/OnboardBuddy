import { Link } from "react-router-dom";
import { PublicPageShell } from "@/components/PublicPageShell";
import { Card, CardContent } from "@/components/ui/card";
import { CONTACT } from "@/lib/contact";

/**
 * The Terms of Service: one panel, numbered sections, "Last updated" at the
 * top, written in plain English with the occasional aside (the Gumloop
 * school of legal writing). Every operational claim stays true to what the
 * code does. Public by design, linked from the landing footer.
 * Copy rules: no em dashes, and no promise that is not backed by code.
 */

function Section({
  n,
  id,
  title,
  children,
}: {
  n: number;
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24">
      <h2 id={`${id}-h`} className="text-[0.9375rem] font-semibold text-foreground">
        {n}. {title}
      </h2>
      <div className="mt-2 space-y-2.5 text-[0.875rem] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

const mailto = `mailto:${CONTACT.email}`;

export function TermsPage() {
  return (
    <PublicPageShell
      title="Terms of Service"
      subtitle="The terms that govern your use of OnboardBuddy."
    >
      <Card>
        <CardContent className="space-y-8 p-6 sm:p-8">
          <p className="font-medium text-foreground">Last updated: September 12, 2026</p>

          <Section n={1} id="intro" title="Introduction">
            <p>
              Welcome to OnboardBuddy! Since you have just clicked into a Terms of Service
              page, please get comfortable, maybe pour a coffee, and give this a read. It is
              shorter than most, and we have done our best to write it in English rather than
              in Legalese.
            </p>
            <p>
              These Terms, together with our{" "}
              <Link to="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              , are the agreement between you and the OnboardBuddy team. By creating an
              account or using the service, you agree to both. If you cannot agree with
              something here, do not use the service, but do tell us at{" "}
              <a href={mailto} className="text-primary hover:underline">
                {CONTACT.email}
              </a>{" "}
              so we can try to find a solution.
            </p>
            <p>Thank you for actually reading this. Most people do not.</p>
          </Section>

          <Section n={2} id="service" title="What OnboardBuddy is">
            <p>
              OnboardBuddy analyzes a GitHub repository you connect and generates onboarding
              documentation from it: a role-based handbook, dependency and architecture maps,
              traced workflows, and tutorials, with every claim cited to the code it came
              from. It is built and operated by a small independent team; there is no company
              behind it.
            </p>
          </Section>

          <Section n={3} id="accounts" title="Your account">
            <p>
              You sign in with an email and password or with GitHub, and you are responsible
              for activity under your account. Keep your credentials to yourself; there is no
              way for the team to verify who is behind a session.
            </p>
            <p>
              You must be at least 13 years old to use OnboardBuddy, and old enough to enter
              into an agreement like this one where you live, or have a parent or guardian
              who agrees to it on your behalf.
            </p>
          </Section>

          <Section n={4} id="repos" title="Repositories you connect">
            <p>
              Connect only repositories you own or have the right to share for analysis.
              Installing the GitHub App on an organization's repositories means you are
              authorized to do so. Access is read-only and limited to the repositories you
              select; the{" "}
              <Link to="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>{" "}
              describes exactly what is read, sent, and stored.
            </p>
          </Section>

          <Section n={5} id="billing" title="Plans, credits, and billing">
            <p>
              OnboardBuddy runs on credits: 1 credit equals CA$1 of AI analysis spend. Every
              plan has a monthly credit budget and a pace limit, listed on the{" "}
              <Link to="/pricing" className="text-primary hover:underline">
                Pricing
              </Link>{" "}
              page. Budgets reset at the start of each month (UTC) and unused credits do not
              roll over. The Free plan really is free.
            </p>
            <p>
              The paid plans, Pro and Max, are announced but cannot be purchased yet. Where
              the app says Coming soon, it means exactly that: no payment is collected, and
              nobody will charge you in the meantime.
            </p>
            <p>
              When paid plans launch, they will be billed monthly in advance through a
              payment processor, we will announce any price change before your next billing
              cycle so you can cancel first, and, except where the law requires otherwise,
              fees will be non-refundable.
            </p>
          </Section>

          <Section n={6} id="ai" title="AI-generated content">
            <p>
              Handbooks, tutorials, and answers are generated with the help of large language
              models. Every claim carries a citation so it can be checked, and unsupported
              answers are stated as unknowns, but generated text can still be incomplete or
              wrong. Review before relying on it, especially for anything security-sensitive
              or destructive.
            </p>
          </Section>

          <Section n={7} id="acceptable" title="Acceptable use">
            <p>
              We built OnboardBuddy to onboard developers, not malware. Use the service only
              for lawful purposes, and do not use it:
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>To analyze code you have no right to access or share.</li>
              <li>
                To probe the service's security, extract other users' data, or disrupt or
                overload its operation.
              </li>
              <li>To generate or distribute malicious code.</li>
              <li>
                To scrape the service or hammer it with automated bulk access outside the
                app.
              </li>
              <li>To impersonate the team, another user, or anyone else.</li>
              <li>To resell the service, or pass it off, as your own.</li>
              <li>
                To dodge free-tier limits by farming accounts. One person gets one free
                budget; accounts created to work around that can lose free access.
              </li>
            </ul>
          </Section>

          <Section n={8} id="ip" title="Ownership">
            <p>
              Your code stays yours; connecting a repository grants OnboardBuddy only the
              limited read access needed to analyze it. Generated documentation belongs to
              the project it was generated for and is shared with that project's members.
              The OnboardBuddy software, name, and design remain the team's.
            </p>
          </Section>

          <Section n={9} id="feedback" title="Feedback">
            <p>
              If you send us feedback, ideas, or suggestions, we may use them freely to
              improve the service without owing you compensation or credit. We will,
              ideally, say thank you.
            </p>
          </Section>

          <Section n={10} id="copyright" title="Copyright complaints">
            <p>
              We respect intellectual property and expect the same of our users. If you
              believe content on OnboardBuddy infringes your copyright, email{" "}
              <a href={mailto} className="text-primary hover:underline">
                {CONTACT.email}
              </a>{" "}
              with "Copyright complaint" in the subject and include: a description of the
              work, where on the service the material appears, a statement that you believe
              in good faith the use is not authorized, and your contact details. We will
              review the claim and remove infringing material where the claim holds.
            </p>
          </Section>

          <Section n={11} id="links" title="Third-party services and links">
            <p>
              OnboardBuddy works alongside services we do not control: GitHub, the model
              providers reached through OpenRouter, and any sites we link to. Each has its
              own terms and policies, those govern your use of them, and we are not
              responsible for what they do. We recommend reading their terms too, though we
              understand if one terms document per day is your limit.
            </p>
          </Section>

          <Section n={12} id="warranty" title="Disclaimer of warranty">
            <p className="font-medium text-foreground">
              OnboardBuddy is provided as is and as available, without warranties of any
              kind, express or implied, including merchantability, fitness for a particular
              purpose, and non-infringement.
            </p>
            <p>
              In plain words: this is an independent project. We work hard to keep it
              accurate and available, and we promise nothing.
            </p>
          </Section>

          <Section n={13} id="liability" title="Limitation of liability">
            <p className="font-medium text-foreground">
              To the extent the law allows, the team is not liable for indirect, incidental,
              special, consequential, or punitive damages, or for lost profits, data, or
              goodwill, arising from your use of the service. Our total liability for all
              claims combined is capped at the greater of CA$100 or the amount you paid us in
              the 12 months before the claim.
            </p>
            <p>
              Some jurisdictions do not allow some of these limits; where that is you, they
              apply only as far as the law permits.
            </p>
          </Section>

          <Section n={14} id="indemnification" title="Indemnification">
            <p>
              If your use of the service, the repositories you connect, or your breach of
              these terms results in a claim against the team, you agree to cover the
              resulting damages and reasonable legal costs. Simplest way to never think
              about this section again: only connect code you have the right to connect.
            </p>
          </Section>

          <Section n={15} id="availability" title="Availability and changes to the service">
            <p>
              OnboardBuddy may be unavailable, rate-limited, changed, or shut down at any
              time. Export anything you want to keep; the handbook export exists for exactly
              that.
            </p>
          </Section>

          <Section n={16} id="termination" title="Termination">
            <p>
              You may stop at any time: uninstall the GitHub App to cut repository access,
              delete individual projects, or delete your account, which permanently removes
              your profile and every project you own. The team may suspend accounts that
              break these terms.
            </p>
          </Section>

          <Section n={17} id="law" title="Governing law">
            <p>
              These terms are governed by the laws of the Province of British Columbia,
              Canada, and the federal laws of Canada applicable there, without regard to
              conflict-of-law rules. Disputes belong to the courts of British Columbia.
            </p>
            <p>
              That said: if something has gone wrong, please write to us first. Nearly
              everything is fixed faster with an email than with a lawyer.
            </p>
          </Section>

          <Section n={18} id="severability" title="Severability and waiver">
            <p>
              If a court finds part of these terms unenforceable, that part is trimmed to
              the minimum necessary and the rest stays in force. If we do not enforce a term
              today, we are not giving it up for tomorrow.
            </p>
          </Section>

          <Section n={19} id="changes" title="Changes to these terms">
            <p>
              These terms may change as the project evolves; the current version always
              lives at this address, and the "Last updated" date at the top moves when it
              does. Continued use after a change means the new terms apply.
            </p>
          </Section>

          <Section n={20} id="contact" title="Contact">
            <p>
              Questions about these terms may be directed to the team through the{" "}
              <Link to="/contact" className="text-primary hover:underline">
                Contact
              </Link>{" "}
              page or by email at{" "}
              <a href={mailto} className="text-primary hover:underline">
                {CONTACT.email}
              </a>
              .
            </p>
          </Section>
        </CardContent>
      </Card>
    </PublicPageShell>
  );
}
