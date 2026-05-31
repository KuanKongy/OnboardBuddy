# Team 15 - OnboardBuddies
## Team members:
- Dinh Nam Khanh Le
- Eugene Ng
- Sahib Rao
- Bradley Sakran

# OnboardBuddy

## Project Description

OnboardBuddy is a codebase onboarding platform that helps developers understand unfamiliar codebases faster. Unlike AI coding assistants that answer questions in ephemeral chat sessions, OnboardBuddy builds a persistent, versioned **Codebase Onboarding Package** grounded in verified code references — not AI-generated guesses.

The core of the platform is a **deterministic analysis pipeline**: the TypeScript Compiler API parses source code into a structured evidence graph, an algorithmic extractor discovers cross-file workflows, and a composite ranking algorithm identifies the Critical 25% — the smallest set of files, symbols, and workflows a developer needs to become productive. An LLM is used only as an optional layer to generate human-readable explanations on top of already-extracted, validated structure.

## What the Platform Has

### Dashboard and Projects
Users connect their GitHub repositories through read-only OAuth and manage them as projects on a central dashboard. Each project card shows the analyzed branch, commit hash, analysis status, and whether any onboarding sections have gone stale. Teams can share projects and control who can view or approve generated content.

### Codebase Onboarding Package
Each analyzed repository gets a structured package with sections covering: repository overview, entry points and why they matter, workflow lifecycle guides, data schema and source of truth, safety rails and tooling commands, and architecture references. Every section includes source receipts linking claims back to specific files and lines, confidence labels (High / Medium / Low), and a draft/review workflow so teams approve content before sharing.

### Interactive Codebase Walkthroughs
Guided, step-by-step traces through critical workflows derived from the evidence graph. Each walkthrough is a sequence of annotated stops through the files and symbols involved in a workflow, with contextual explanations at each stop. Walkthroughs are persistent, role-specific, and validated against real code paths — not generated from scratch each time.

### Role-Based Learning Paths
The same codebase produces different onboarding paths depending on the developer's role. A backend developer sees routes, services, auth, and database writes first. A frontend developer sees pages, components, state, and API clients. DevOps sees CI/CD, Docker, deploy scripts, and environment configuration. QA sees test structure, fixtures, coverage, and critical flows.

### Architecture and Dependency Graphs
Interactive visualizations (React Flow / D3.js) show high-level architecture maps, dependency clusters grouped by module, class/interface relationships, and workflow path diagrams. Graphs are pull-based — the system shows relevant slices, not the entire repo graph.

### Documentation Drift Detection
When code changes, the platform compares file and symbol hashes across analysis snapshots to identify which onboarding sections and linked repository docs may be stale. Teams can regenerate specific sections or mark them as reviewed.

## Tech Stack

| Layer | Technology |
| ----- | ----- |
| Frontend | React + TypeScript, React Flow / D3.js |
| Backend | Node.js + Express + TypeScript |
| Static Analysis | TypeScript Compiler API |
| Auth | Supabase Auth |
| Database | Supabase PostgreSQL |
| Repo Access | GitHub API + Git CLI |
| AI | OpenAI API (explanation generation only) |
| Infra | Docker, GitHub Actions |

## Milestone 1
- [Proposal document](doc/Team-15-proposal.pdf)
- [Design document](doc/Team-15-design.pdf)