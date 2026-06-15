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
│   ├── saveGithubToken.ts # Saves GitHub OAuth token to backend
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
3. On GitHub OAuth, `AuthCallbackPage` waits for `SIGNED_IN` event, saves GitHub token to backend via `POST /auth/github/save-token`
4. `ProtectedRoute` guards all authenticated routes, redirecting to `/login` if unauthenticated
5. `apiFetch` attaches `Bearer <access_token>` to all API requests, auto-refreshes session on 401

## Routing

### Public Routes

| Path | Page | Purpose |
|---|---|---|
| `/` | IntroPage | Landing page (redirects to dashboard if logged in) |
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
| `/projects/:id/dependencies` | EmptyStubPage | Stubbed |
| `/projects/:id/walkthrough` | EmptyStubPage | Stubbed |
| `/projects/:id/team` | TeamPage | Implemented |
| `/projects/:id/settings` | ProjectSettingsPage | Implemented |

## Theming

The app uses a dark-only Supabase-inspired theme. Colors are defined as CSS custom properties in `styles.css` and consumed by shadcn/ui components automatically:

- **Background**: near-black (`oklch(0.145 0 0)`)
- **Card/Surface**: slightly lighter dark
- **Primary accent**: emerald green (Supabase brand-style)
- **Text**: light gray foreground with muted secondary
- **Destructive**: rose red for danger actions

Font: Inter (system font stack fallback).

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

### TeamPage
- Member grid with avatar, email, role/tier badges
- Invite modal (owner/admin only) via `POST /projects/:id/members/invitations`
- Remove member (owner/admin) via `DELETE /projects/:id/members/members/:userId`

### ProjectSettingsPage
- Single-column layout: repo info, default role, ignored paths, analysis limits, danger zone
- Save via `PUT /projects/:id/settings`
- Delete via `DELETE /projects/:id` with confirmation dialog
- Read-only for developer tier

## Contexts

### AuthContext
- `user`: current Supabase user object
- `session`: current Supabase session
- `loading`: initial auth state loading
- `signIn(email, password)`, `signUp(email, password)`, `signOut()`, `signInWithGithub()`

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
