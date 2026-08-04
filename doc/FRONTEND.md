# Frontend Documentation

## Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| React | 19 | UI framework |
| Vite | 7 | Build tool and dev server |
| Tailwind CSS | 4 | Utility-first CSS (via `@tailwindcss/vite`) |
| shadcn/ui | new-york style | Component library (Radix UI primitives) |
| React Router | 7 | Client-side routing |
| Lucide React | latest | Icon library |
| Supabase JS | 2.x | Auth client (GitHub OAuth + email/password) |

## Project Structure

```
frontend/src/
├── components/
│   ├── ui/               # shadcn/ui generated components
│   │   ├── avatar.tsx
│   │   ├── badge.tsx
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── progress.tsx
│   │   ├── select.tsx
│   │   ├── separator.tsx
│   │   ├── table.tsx
│   │   ├── tabs.tsx
│   │   ├── textarea.tsx
│   │   └── tooltip.tsx
│   ├── ProjectCard.tsx    # Project card for dashboard grid
│   ├── ProjectLayout.tsx  # Project-scoped layout with sidebar
│   ├── ProtectedRoute.tsx # Auth guard for protected routes
│   └── Sidebar.tsx        # Global navigation sidebar
├── contexts/
│   ├── AuthContext.tsx     # Auth state (user, session, signIn/Out)
│   └── ProjectContext.tsx  # Current project data + membership
├── lib/
│   ├── api.ts             # apiFetch wrapper with auth headers
│   ├── supabase.ts        # Supabase client instance
│   └── utils.ts           # cn() utility for class merging
├── pages/
│   ├── AccountSettingsPage.tsx
│   ├── AuthCallbackPage.tsx
│   ├── DashboardPage.tsx
│   ├── EmptyStubPage.tsx
│   ├── ImportPage.tsx
│   ├── IntroPage.tsx
│   ├── InvitationsPage.tsx
│   ├── LoginPage.tsx
│   ├── ProjectOverviewPage.tsx
│   ├── ProjectSettingsPage.tsx
│   ├── SignupPage.tsx
│   └── TeamPage.tsx
├── App.tsx                # Root component with routes
└── styles.css             # Tailwind + shadcn/ui CSS variables
```

## Authentication Flow

1. User signs in via email/password or GitHub OAuth (Supabase Auth)
2. `AuthContext` manages `user` and `session` state via `supabase.auth.onAuthStateChange`
3. On GitHub login, `AuthCallbackPage` waits for `SIGNED_IN` event and redirects to the dashboard
4. `ProtectedRoute` guards all authenticated routes, redirecting to `/login` if unauthenticated
5. `apiFetch` attaches `Bearer <access_token>` to all API requests, auto-refreshes session on 401

## Routing

### Public Routes

| Path | Page | Purpose |
|---|---|---|
| `/` | IntroPage | Public landing page; signed-in visitors are not redirected (header, hero and closing band offer "Go to dashboard") |
| `/login` | LoginPage | Email/password + GitHub OAuth login |
| `/signup` | SignupPage | Account creation |
| `/auth/callback` | AuthCallbackPage | OAuth redirect handler |

### Protected Routes (global sidebar)

| Path | Page | Purpose |
|---|---|---|
| `/dashboard` | DashboardPage | Project list with search + filters |
| `/import` | ImportPage | Single-form repository import |
| `/invitations` | InvitationsPage | Pending invitations with role selection |
| `/settings` | AccountSettingsPage | Profile, GitHub connection, sign out |

### Protected Routes (project sidebar)

| Path | Page | Status |
|---|---|---|
| `/projects/:id` | ProjectOverviewPage | Implemented |
| `/projects/:id/onboarding` | EmptyStubPage | Stubbed |
| `/projects/:id/architecture` | EmptyStubPage | Stubbed |
| `/projects/:id/dependencies` | GraphPage | Implemented (module dependency graph) |
| `/projects/:id/walkthrough` | EmptyStubPage | Stubbed |
| `/projects/:id/team` | TeamPage | Implemented |
| `/projects/:id/settings` | ProjectSettingsPage | Implemented |

## Theming

Light and dark themes, both OKLCH token systems defined in `src/styles.css` (`:root` and `.dark`) and mapped to Tailwind v4 utilities via `@theme inline`. The `.dark` class lands on `<html>` before first paint via `public/bootstrap.js` (localStorage `onboardbuddy:theme`, falling back to the OS preference) and is toggled at runtime by `ThemeToggle`.

- **Light background**: pure white (`oklch(1 0 0)`); cards separate via border + shadow
- **Dark**: a slate-blue surface ladder (background 0.21 → card 0.27 → popover 0.30) with borders a step above
- **Semantic tokens**: success/warning/danger/info plus `-soft` chip fills; the categorical `--node-*` palette drives the graph, the architecture map and the landing visuals from one place
- **Brand hexes**: `#2659f4` blue and `#0c1c3b` navy live only in `BrandLogo.tsx`; the favicon draws the mark blue and white on a `#15181f` rounded square (one design for both themes), and the landing's decorative gradients reuse the blue
- **Font**: Inter, self-hosted as variable woff2 files in `public/fonts/` (roman preloaded, italic loads on demand)
- **Motion**: the landing's `landing-*` keyframes, story stage system and `.reveal` scroll transitions live in `styles.css`; a global `prefers-reduced-motion` rule collapses every animation and transition to an instant end state

## Page Details

### DashboardPage
- Fetches `GET /projects` for user's projects
- Search bar filters by name/branch
- Tab filters: All, Active, Stale, Completed
- "Add New Repository" card links to import
- "Join Project" links to invitations

### InvitationsPage
- Two-panel layout: left lists invitations, right shows selected detail
- Role selection when no role is pre-assigned
- Accept via `POST /invitations/:id/accept`

### ImportPage
- Single-form (Supabase-style) replacing previous 6-step wizard
- Fields: GitHub account (select), repository (select), display name, branch, role, ignored paths
- Creates project via `POST /projects` then triggers `POST /projects/:id/analyze`

### ProjectOverviewPage
- Quick action cards (onboarding, tutorial, role)
- Analysis status with progress bar
- Stats placeholders (files, symbols, workflows)
- Role packages table

### GraphPage (`/projects/:id/dependencies`)
- Renders the module dependency graph (Feature 2's "module dependency graph" view) using `reactflow`
- Data comes from `fetchDependencyGraph(projectId)` in `lib/graphData.ts`, which currently resolves a static fixture (`lib/mockGraphData.ts`) shaped like the analysis pipeline's eventual output (`repoIndex`, `fileAnalyses`, `graph.{nodes,edges,entryPoints}`); swapping in the real `GET /projects/:id/graph` endpoint once the analysis pipeline ships is a one-line change in that file
- `lib/graphLayout.ts` computes a layered (left-to-right) layout via longest-path-from-root leveling from the graph's entry points — no layout library dependency needed for this graph size
- `components/graph/` holds `ModuleNode` (custom React Flow node), `DependencyGraphView` (canvas + neighbor highlighting on selection), `GraphToolbar` (search + kind filter), and `NodeDetailPanel` (drill-down into a file's exported symbols and imports — the "source receipt" stub)
- Architecture map, class/interface graph, role-based filtering, and workflow graph views are not yet implemented (`/projects/:id/architecture` and `/projects/:id/walkthrough` remain `EmptyStubPage`)

### TeamPage
- Member grid with avatar, email, role/tier badges
- Invite modal (owner/admin only) via `POST /projects/:id/members/invitations`
- Remove member (owner/admin) via `DELETE /projects/:id/members/members/:userId`

### ProjectSettingsPage
- Single-column layout: repo info, developer role, ignored paths, analysis limits, danger zone
- Save via `PUT /projects/:id/settings`
- Delete via `DELETE /projects/:id` with confirmation dialog
- Read-only for developer tier

## Contexts

### AuthContext
- `user`: current Supabase user object
- `session`: current Supabase session
- `loading`: initial auth state loading
- `signIn(email, password)`, `signUp(email, password)`, `signOut()`, `signInWithGithub()`, `connectGithub()`, `disconnectGithub()`

### ProjectContext
- `project`: full project data including settings and membership tier
- `loading`: project fetch loading state
- `error`: fetch error message
- `refetch()`: re-fetch project data

## API Integration

All API calls go through `apiFetch(path, options)` in `lib/api.ts`:
- Base URL from `VITE_API_URL` env var
- Auto-attaches `Authorization: Bearer <token>` header
- Auto-refreshes session and retries once on 401
- Returns parsed JSON response
- Throws `Error` with backend error message on non-2xx responses
