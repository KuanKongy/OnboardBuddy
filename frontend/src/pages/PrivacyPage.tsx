import { Link } from "react-router-dom";
import { PublicPageShell } from "@/components/PublicPageShell";
import { Card, CardContent } from "@/components/ui/card";
import { PRIVACY_MODES } from "@/lib/privacyModes";

/**
 * The privacy policy, public by design: the landing page links here and the
 * answer must not sit behind a login. It reads as a policy, but every claim
 * states something the code actually does, so a reviewer can diff it against
 * the pipeline (the privacy filter, the mode enforcement, the OpenRouter
 * request options). The compact in-app version lives at /help#privacy.
 * Copy rules: no em dashes, and no promise that is not backed by code.
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

export function PrivacyPage() {
  return (
    <PublicPageShell
      title="Privacy Policy"
      subtitle="What OnboardBuddy reads, what reaches a model, what is stored, and what never leaves."
    >
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-2.5 p-5 text-[0.875rem] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Effective date: August 5, 2026</p>
            <p>
              OnboardBuddy is built and operated by its development team as a university course
              project. There is no separate company behind it and no dedicated privacy office, so
              this policy names the team itself as responsible for the handling described below.
              Questions about this policy, or about data held under your account, are best raised
              as an issue on the project's repository, which is where the team answers them.
            </p>
          </CardContent>
        </Card>

        <Section id="scope" title="Scope of this policy">
          <p>
            This policy covers the OnboardBuddy web application and the analysis pipeline behind
            it: the repositories you connect, the account data needed to sign you in, and the
            documentation generated from your code. It does not cover GitHub itself, or the
            model providers reached through OpenRouter, beyond describing what is sent to them and
            under which settings. Those services have their own policies.
          </p>
        </Section>

        <Section id="access" title="What we access">
          <p>
            Repositories connect through a GitHub App installation with read-only permissions
            (repository contents and metadata). You choose exactly which repositories the app can
            see, and you can change or revoke that selection on GitHub at any time. OnboardBuddy
            never has write access to your code and never sees repositories you did not share.
          </p>
          <p>
            Analysis works from a temporary archive of the repository that is extracted for the
            run and deleted when the run finishes. No full permanent copy of your repository is
            kept.
          </p>
          <p>
            Account data is limited to what signing in requires: your identity from the sign-in
            provider, your email address, and your per-project membership and settings.
          </p>
        </Section>

        <Section id="modes" title="The three privacy modes">
          <p>
            Each project chooses how much reaches a model. The mode applies to every run and is
            enforced mechanically in the pipeline, not promised in a prompt: evidence bundles are
            assembled with code snippets stripped before anything reaches a provider when the mode
            forbids them.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            {PRIVACY_MODES.map((mode) => (
              <li key={mode.key}>
                <span className="font-medium text-foreground">{mode.label}:</span> {mode.hint}
              </li>
            ))}
          </ul>
          <p>
            The mode used for a run is stamped on that analysis, so older results keep the promise
            they were made under even if the project's mode changes later.
          </p>
        </Section>

        <Section id="always" title="Protections in every mode">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Secret-bearing files are filtered out during ingestion, always: environment files
              (.env and variants), private keys and certificates (.pem, .key, .p12 and similar),
              credential files, and paths matching secret patterns (.ssh, .aws, anything named
              secret or credential). Example and template files like .env.example stay readable.
            </li>
            <li>
              Your ignore rules apply first: .gitignore-style exclusions plus per-project ignored
              paths, and a built-in list that always excludes dependencies, build output, and
              test fixtures.
            </li>
            <li>The browser never receives full repository source; it sees generated documentation and the specific cited lines.</li>
            <li>Every generated claim carries a citation to the file and line it came from, so nothing has to be taken on trust.</li>
          </ul>
        </Section>

        <Section id="providers" title="Where AI requests go">
          <p>
            AI calls run through OpenRouter with <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.75rem] text-foreground">data_collection: deny</code>{" "}
            set on every request, and routing restricted to zero-data-retention providers. What a
            given model provider then does with a request is governed by{" "}
            <a
              href="https://openrouter.ai/docs/features/privacy-and-logging"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              OpenRouter's privacy policy
            </a>
            . Embeddings for retrieval use an OpenAI-compatible endpoint under the same
            configuration. With a project-level API key, calls run under your own OpenRouter
            account instead of a shared one.
          </p>
          <p className="font-medium text-foreground">
            Your code and the documentation generated from it are never used to train models and
            never sold.
          </p>
        </Section>

        <Section id="stored" title="What we store and for how long">
          <p>
            OnboardBuddy stores the artifacts it generates and the facts needed to keep citations
            honest: extracted symbols and relationships (the evidence graph), traced workflows,
            rankings, generated handbook sections and tutorials with their citations, analysis
            run metadata (phases, timings, spend), and the specific cited code lines that back
            receipts.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Generated artifacts and run history persist until the project or the account they
              belong to is deleted. They are not expired on a timer, because a handbook that
              disappeared on its own would be worse than no handbook.
            </li>
            <li>
              The temporary repository archive and the working directory extracted from it are
              deleted at the end of each run, including runs that fail.
            </li>
            <li>
              Queue entries are transient: a job holds identifiers and run parameters, not
              repository content, and completed jobs are dropped once a short recent-jobs window
              moves past them.
            </li>
          </ul>
        </Section>

        <Section id="processors" title="Sub-processors">
          <p>
            Four services process data on OnboardBuddy's behalf. Each is listed with what it
            does and what reaches it.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-medium text-foreground">Supabase:</span> authentication and
              the database holding generated artifacts, account data, and project settings.
            </li>
            <li>
              <span className="font-medium text-foreground">GitHub:</span> sign-in identity and
              the read-only App installation used to fetch the repositories you selected.
            </li>
            <li>
              <span className="font-medium text-foreground">OpenRouter:</span> routing of AI
              requests to model providers; request and response logs exist only on its dashboard,
              under the account whose key is used.
            </li>
            <li>
              <span className="font-medium text-foreground">Upstash Redis:</span> the job queue
              that carries analysis and generation jobs; it holds job identifiers and parameters,
              not repository content.
            </li>
          </ul>
        </Section>

        <Section id="rights" title="Your rights and controls">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Access: everything stored for a project is readable in the app, including the
              generated documentation, every citation behind it, and the history of each run.
            </li>
            <li>
              Correction: your profile is editable in Account Settings, and a project's
              privacy mode, ignored paths, and role defaults are editable in Project Settings.
              A privacy mode change applies to every following run.
            </li>
            <li>
              Deletion: deleting a project removes it and its analyses. Deleting your account
              permanently deletes your sign-in, your profile, and every project you own, including
              all analyses, onboarding packages, and team memberships. Runs you started in other
              people's projects are re-attributed to those projects' owners. This
              cannot be undone.
            </li>
            <li>
              Restriction: add ignored paths so specific directories never enter analysis at all,
              or run a project in a mode that sends no code, or no AI requests at all.
            </li>
            <li>
              Bring your own OpenRouter key so AI calls run under your account, and disconnect
              GitHub or uninstall the App to cut repository access immediately.
            </li>
          </ul>
        </Section>

        <Section id="changes" title="Changes to this policy">
          <p>
            This policy may change as the project evolves. Changes are announced on this page with
            a new effective date, and the current version always lives at this address.
          </p>
          <p>
            The same questions in product terms are answered in the{" "}
            <Link to="/faq" className="text-primary hover:underline">
              FAQ
            </Link>
            ; the terms governing use of the service are on the{" "}
            <Link to="/terms" className="text-primary hover:underline">
              Terms
            </Link>{" "}
            page.
          </p>
        </Section>
      </div>
    </PublicPageShell>
  );
}
