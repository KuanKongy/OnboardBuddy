import type { OnboardingPackage } from "@/types/onboarding";

export const MOCK_ONBOARDING_PACKAGES: Record<string, OnboardingPackage> = {
  backend: {
    projectId: "demo",
    role: "backend",
    status: "draft",
    generatedAt: "2026-06-17T08:00:00Z",
    reviewedBy: "sarah",
    sections: [
      {
        id: "start-here",
        label: "Start Here",
        status: "complete",
        confidence: "high",
        reviewedBy: "sarah",
        reviewedAt: "2h ago",
        blocks: [
          {
            title: "What this service does",
            body: "payments-api is the central payment processing service for Acme's platform. It handles charge creation, refund processing, webhook delivery to merchants, and monthly reconciliation with Stripe and PayPal. It is consumed by the web-app, mobile clients, and internal billing jobs over REST.",
            receipts: [
              { filePath: "src/routes/index.ts", lineStart: 1, lineEnd: 45, staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
              { filePath: "README.md", lineStart: 1, lineEnd: 24, staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
            ],
          },
          {
            title: "How to run locally",
            body: "Copy .env.example → .env and fill in STRIPE_TEST_KEY and DATABASE_URL. Then: npm install && npm run migrate && npm run dev. The server listens on :3001 by default. Run npm test to execute the Jest suite.",
            receipts: [
              { filePath: "README.md", lineStart: 40, lineEnd: 71, staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
              { filePath: ".env.example", lineStart: 1, lineEnd: 32, staleness: "stale", confidence: "medium", ageLabel: "36h ago" },
            ],
          },
          {
            title: "First things to read",
            body: "Start with src/routes/index.ts for the full API surface, then src/services/chargeService.ts for the core business logic. The data models live under src/models/ and follow a standard ActiveRecord-style pattern.",
            receipts: [
              { filePath: "src/routes/index.ts", lineStart: 1, lineEnd: 94, staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
              { filePath: "src/services/chargeService.ts", lineStart: 1, lineEnd: 128, staleness: "fresh", confidence: "medium", ageLabel: "2h ago" },
            ],
          },
        ],
      },
      {
        id: "entry-points",
        label: "Entry Points",
        status: "complete",
        confidence: "high",
        blocks: [
          {
            title: "HTTP entry points",
            body: "All routes are registered in src/routes/index.ts. Authentication middleware is applied globally in src/middleware/auth.ts. Route handlers delegate immediately to service layer — avoid putting business logic in controllers.",
            receipts: [
              { filePath: "src/routes/index.ts", lineStart: 1, lineEnd: 94, staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
              { filePath: "src/middleware/auth.ts", lineStart: 1, lineEnd: 38, staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
            ],
          },
          {
            title: "Background job entry points",
            body: "Cron jobs are defined in src/jobs/. The reconciliation job runs nightly via src/jobs/reconcile.ts and is registered in src/jobs/index.ts. Job failures write to the job_errors table and trigger a PagerDuty alert.",
            receipts: [
              { filePath: "src/jobs/index.ts", lineStart: 1, lineEnd: 28, staleness: "fresh", confidence: "medium", ageLabel: "2h ago" },
              { filePath: "src/jobs/reconcile.ts", lineStart: 1, lineEnd: 85, staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
            ],
          },
        ],
      },
      {
        id: "critical-25",
        label: "Critical 25%",
        status: "complete",
        confidence: "high",
        blocks: [
          {
            title: "Core files (top 25% by impact)",
            body: "These files account for the majority of the system's behaviour. Understanding them gives you leverage over the entire codebase.",
            receipts: [
              { filePath: "src/services/chargeService.ts", staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
              { filePath: "src/services/refundService.ts", staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
              { filePath: "src/models/Payment.ts", staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
              { filePath: "src/lib/stripe.ts", staleness: "stale", confidence: "medium", ageLabel: "14h ago" },
              { filePath: "src/middleware/auth.ts", staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
            ],
          },
        ],
      },
      {
        id: "workflows",
        label: "Workflows",
        status: "complete",
        confidence: "medium",
        blocks: [
          {
            title: "Charge creation flow",
            body: "POST /charges → chargeService.create() → Stripe API → persist Payment record → emit payment.created event → return 201. Idempotency is enforced via the idempotency_key column on payments.",
            receipts: [
              { filePath: "src/services/chargeService.ts", lineStart: 12, lineEnd: 67, staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
            ],
          },
          {
            title: "Refund flow",
            body: "POST /charges/:id/refunds → refundService.create() → Stripe refund API → update Payment.status → emit payment.refunded event. Partial refunds are supported; full refunds mark status as refunded.",
            receipts: [
              { filePath: "src/services/refundService.ts", lineStart: 1, lineEnd: 55, staleness: "fresh", confidence: "medium", ageLabel: "2h ago" },
            ],
          },
        ],
      },
      {
        id: "data-schema",
        label: "Data Schema",
        status: "stale",
        confidence: "medium",
        blocks: [
          {
            title: "Core tables",
            body: "payments (id, amount, currency, status, stripe_charge_id, idempotency_key, created_at), refunds (id, payment_id, amount, reason, created_at), webhooks (id, merchant_id, url, events, secret). Schema managed by Knex migrations in db/migrations/.",
            receipts: [
              { filePath: "db/migrations/001_create_payments.ts", staleness: "stale", confidence: "medium", ageLabel: "3d ago" },
              { filePath: "src/models/Payment.ts", staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
            ],
          },
        ],
      },
      {
        id: "safety-rails",
        label: "Safety Rails",
        status: "complete",
        confidence: "high",
        blocks: [
          {
            title: "Things not to touch without review",
            body: "Never modify src/lib/stripe.ts directly — changes require a security review and sign-off from @payments-platform. The idempotency_key column must never be changed after insert. Migration rollbacks on payments table require DBA approval.",
            receipts: [
              { filePath: "src/lib/stripe.ts", staleness: "stale", confidence: "medium", ageLabel: "14h ago" },
            ],
          },
          {
            title: "Required environment variables",
            body: "STRIPE_SECRET_KEY, DATABASE_URL, JWT_SECRET, WEBHOOK_SIGNING_SECRET are all required at startup. The app will throw and exit if any are missing. Use .env.example as reference.",
            receipts: [
              { filePath: ".env.example", staleness: "stale", confidence: "medium", ageLabel: "36h ago" },
              { filePath: "src/config.ts", lineStart: 1, lineEnd: 22, staleness: "fresh", confidence: "high", ageLabel: "2h ago" },
            ],
          },
        ],
      },
      {
        id: "dependency-graph",
        label: "Dependency Graph",
        status: "missing",
        confidence: "low",
        blocks: [],
      },
      {
        id: "doc-health",
        label: "Documentation Health",
        status: "missing",
        confidence: "low",
        blocks: [],
      },
    ],
  },
  frontend: {
    projectId: "demo",
    role: "frontend",
    status: "missing",
    generatedAt: "",
    sections: [],
  },
  devops: {
    projectId: "demo",
    role: "devops",
    status: "missing",
    generatedAt: "",
    sections: [],
  },
  qa: {
    projectId: "demo",
    role: "qa",
    status: "missing",
    generatedAt: "",
    sections: [],
  },
  general: {
    projectId: "demo",
    role: "general",
    status: "draft",
    generatedAt: "2026-06-17T08:00:00Z",
    sections: [
      {
        id: "start-here",
        label: "Start Here",
        status: "complete",
        confidence: "high",
        blocks: [
          {
            title: "What this repo is",
            body: "This is a full-stack web application for analysing and onboarding developers into unfamiliar codebases. It consists of a Node/Express API backend, a React frontend, and a PostgreSQL database managed via Supabase. The system ingests a GitHub repository, runs static analysis, and generates role-specific onboarding packages.",
            receipts: [
              { filePath: "README.md", lineStart: 1, lineEnd: 20, staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: "package.json", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
            ],
          },
          {
            title: "How to run locally",
            body: "Prerequisites: Node 20+, Docker (for Postgres). Clone the repo, copy .env.example to .env and fill in SUPABASE_URL, SUPABASE_ANON_KEY, and GITHUB_TOKEN. Then run: npm install && npm run dev. The frontend starts on :5173 and the API on :3001.",
            receipts: [
              { filePath: "README.md", lineStart: 22, lineEnd: 55, staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: ".env.example", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: "docker-compose.yml", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
            ],
          },
          {
            title: "First things to read",
            body: "Start with README.md for the big picture, then frontend/src/App.tsx to understand routing, and backend/src/index.ts to see how the API is wired up. The Supabase schema lives in supabase/migrations/.",
            receipts: [
              { filePath: "frontend/src/App.tsx", lineStart: 1, lineEnd: 72, staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: "backend/src/index.ts", lineStart: 1, lineEnd: 50, staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
            ],
          },
        ],
      },
      {
        id: "entry-points",
        label: "Entry Points",
        status: "complete",
        confidence: "high",
        blocks: [
          {
            title: "Frontend entry point",
            body: "The React app boots from frontend/src/main.tsx which mounts App.tsx. All routes are defined in App.tsx using React Router v6. Protected routes are wrapped in ProtectedRoute which checks Supabase auth state from AuthContext.",
            receipts: [
              { filePath: "frontend/src/main.tsx", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: "frontend/src/App.tsx", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: "frontend/src/components/ProtectedRoute.tsx", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
            ],
          },
          {
            title: "Backend entry point",
            body: "The Express server starts in backend/src/index.ts. Routes are registered under /api and split by domain (projects, onboarding, analysis). Auth is enforced via a JWT middleware that validates Supabase tokens.",
            receipts: [
              { filePath: "backend/src/index.ts", lineStart: 1, lineEnd: 50, staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: "backend/src/middleware/auth.ts", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
            ],
          },
        ],
      },
      {
        id: "critical-25",
        label: "Critical 25%",
        status: "complete",
        confidence: "high",
        blocks: [
          {
            title: "Most important files",
            body: "These files cover the core of the system. Reading them in order gives you a working mental model of how the product functions end-to-end.",
            receipts: [
              { filePath: "frontend/src/App.tsx", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: "frontend/src/contexts/AuthContext.tsx", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: "frontend/src/contexts/ProjectContext.tsx", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: "frontend/src/lib/api.ts", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: "backend/src/index.ts", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: "supabase/migrations/001_init.sql", staleness: "fresh", confidence: "medium", ageLabel: "1h ago" },
            ],
          },
        ],
      },
      {
        id: "workflows",
        label: "Workflows",
        status: "complete",
        confidence: "medium",
        blocks: [
          {
            title: "Importing a new project",
            body: "User pastes a GitHub repo URL on the Import page → frontend calls POST /api/projects → backend clones/fetches repo metadata via GitHub API → creates a project row in Supabase → triggers analysis job → user is redirected to the project overview while analysis runs.",
            receipts: [
              { filePath: "frontend/src/pages/ImportPage.tsx", staleness: "fresh", confidence: "medium", ageLabel: "1h ago" },
            ],
          },
          {
            title: "Viewing a project's onboarding package",
            body: "User navigates to /projects/:id/onboarding → frontend calls GET /api/projects/:id/onboarding?role=general → if a package exists it renders the section viewer; if missing it shows the Generate prompt. Sections can be individually regenerated by owners/admins.",
            receipts: [
              { filePath: "frontend/src/pages/OnboardingPage.tsx", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
            ],
          },
        ],
      },
      {
        id: "data-schema",
        label: "Data Schema",
        status: "complete",
        confidence: "medium",
        blocks: [
          {
            title: "Key tables",
            body: "projects (id, repo_owner, repo_name, branch, status, developer_role, permission_tier), onboarding_packages (id, project_id, role, status, generated_at), onboarding_sections (id, package_id, section_id, content, confidence, reviewed_by). Users and auth are handled by Supabase Auth — no custom users table.",
            receipts: [
              { filePath: "supabase/migrations/001_init.sql", staleness: "fresh", confidence: "medium", ageLabel: "1h ago" },
            ],
          },
        ],
      },
      {
        id: "safety-rails",
        label: "Safety Rails",
        status: "complete",
        confidence: "high",
        blocks: [
          {
            title: "Things to be careful about",
            body: "Never expose SUPABASE_SERVICE_ROLE_KEY on the frontend — it bypasses Row Level Security. All API routes must go through the JWT middleware; do not add unauthenticated routes without team review. RLS policies on the projects table ensure users can only read their own projects.",
            receipts: [
              { filePath: "backend/src/middleware/auth.ts", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
              { filePath: ".env.example", staleness: "fresh", confidence: "high", ageLabel: "1h ago" },
            ],
          },
        ],
      },
      {
        id: "dependency-graph",
        label: "Dependency Graph",
        status: "missing",
        confidence: "low",
        blocks: [],
      },
      {
        id: "doc-health",
        label: "Documentation Health",
        status: "missing",
        confidence: "low",
        blocks: [],
      },
    ],
  },
};

export const SECTION_NAV_ORDER = [
  "start-here",
  "entry-points",
  "critical-25",
  "workflows",
  "data-schema",
  "safety-rails",
  "dependency-graph",
  "doc-health",
] as const;

export const ROLES = [
  { key: "backend", label: "Backend Developer" },
  { key: "frontend", label: "Frontend Developer" },
  { key: "devops", label: "DevOps Engineer" },
  { key: "qa", label: "QA Engineer" },
  { key: "general", label: "General" },
];
