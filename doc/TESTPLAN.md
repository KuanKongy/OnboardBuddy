# OnboardBuddy — Test Plan

This document describes how OnboardBuddy is tested. It covers the **automated test
suite** (what runs in CI and how to run it locally) and the **manual test
checklists**.

The plan is organized around the three components of the monorepo:

| Component | Stack | Test tooling |
|---|---|---|
| **Backend API** | Express 5 + TypeScript | Mocha + Chai + Supertest |
| **Frontend UI** | React 19 + Vite | Vitest + Testing Library (unit/component), Playwright (e2e) |
| **Worker / pipeline** | Node + BullMQ | Mocha + Chai (unit + pipeline integration) |

---

## 2. Automated Tests

From the repository root:

```bash
npm install        # first time only
npm run test       # runs backend (Mocha) + frontend (Vitest) across workspaces
npm run lint       # ESLint across the monorepo
npm run build      # type-check + production build of both workspaces
```

`npm run test` fans out to each workspace's `test` script via npm workspaces.

---

## 3. Manual Test Checklists

Run these against a locally running stack (`npm run dev`) with valid `.env` files
configured per the README. The test repo should also have been forked.

> Environment: frontend `http://localhost:5173`

- "Sign in with GitHub" completes the OAuth consent and returns a session.
- From Account Settings, "Connect GitHub" starts the GitHub App user
      authorization and returns to the app successfully.
- Returning to the Dashboard and clicking "Import Repository" begins the Repository
      import flow
- Clicking "Configure repositories" lets you install/configure the OnboardBuddy GitHub App.
- After install, the installations list shows repos the connected
      user can access.
- Selecting a repository and branch is possible and persists.
- Creating a project records owner, repo name, and branch.
- Triggering analysis enqueues a job and the UI reflects an in-progress state.
- On completion, an analysis snapshot with graph nodes/edges is produced.
- The generated onboarding package renders with sections.
- Sections show source receipts / evidence linking back to code.
- The dependency graph page renders nodes and edges and is navigable.
- The walkthrough tab steps through the workflows in order.
- The team tab shows the user
- A project owner can invite a member by email.
- An invited user can accept and gains access to the project.