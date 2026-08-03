/**
 * Design-time data for the hero story: scene order and timings, the analysis
 * checklist, and the node/cluster layout tables for the graph and morph
 * scenes. Coordinates are percentages of the stage (chips are centered on
 * their coordinate; the edge SVG uses the same numbers in a 0-100 viewBox).
 *
 * Honesty contracts, unit-tested in HeroStory.test.tsx:
 *   - every analysis step maps to a real PHASE_ORDER key
 *   - every cluster kind exists in CLUSTER_KIND_LABELS
 * The repository and files are deliberately fictional (acme/storefront), so
 * the story never claims a specific real analysis it didn't run.
 */

export const STORY_SCENES = [
  {
    id: "import",
    title: "Pick a repository",
    caption: "Connect through the GitHub App and pick a repository. Nothing runs yet.",
    duration: 2600,
  },
  {
    id: "analysis",
    title: "The pipeline runs",
    caption: "Deterministic phases parse, graph and trace before any model is asked.",
    duration: 3400,
  },
  {
    id: "graph",
    title: "The graph draws itself",
    caption: "Imports and calls become a dependency map with marked entry points.",
    duration: 3000,
  },
  {
    id: "architecture",
    title: "Files become architecture",
    caption: "The same files cluster into named layers: the architecture map.",
    duration: 2800,
  },
  {
    id: "tutorial",
    title: "A tutorial opens",
    caption: "Tutorials follow one real path through the code, with citations.",
    duration: 3200,
  },
] as const;

export type StorySceneId = (typeof STORY_SCENES)[number]["id"];

/** Display labels are the friendly storyboard names; each maps to a real
 *  pipeline phase key so the story cannot invent a stage that doesn't run. */
export const STORY_ANALYSIS_STEPS = [
  { phaseKey: "ingest", label: "Cloning repository" },
  { phaseKey: "parse", label: "Parsing TypeScript" },
  { phaseKey: "graph", label: "Building the dependency graph" },
  { phaseKey: "workflows", label: "Tracing workflows" },
  { phaseKey: "generation", label: "Generating the onboarding handbook" },
] as const;

export const STORY_REPOS = ["acme/storefront", "acme/design-system", "acme/infra"] as const;

export type StoryClusterKind = "frontend_ui" | "api_layer" | "worker_layer" | "database_layer";

export interface StoryNode {
  id: string;
  file: string;
  /** Categorical --node-* token, same palette as the real graph. */
  token: "api" | "ui" | "data" | "worker" | "config" | "test" | "shared" | "state";
  cluster: StoryClusterKind;
  entry?: boolean;
  /** Position in the graph scene, % of stage. */
  g: { x: number; y: number };
  /** Position inside its cluster card in the architecture scene, % of stage. */
  a: { x: number; y: number };
}

export const STORY_NODES: readonly StoryNode[] = [
  { id: "app", file: "App.tsx", token: "ui", cluster: "frontend_ui", g: { x: 10, y: 20 }, a: { x: 15, y: 27 } },
  { id: "checkout", file: "Checkout.tsx", token: "ui", cluster: "frontend_ui", g: { x: 10, y: 46 }, a: { x: 31, y: 27 } },
  { id: "cart", file: "Cart.tsx", token: "ui", cluster: "frontend_ui", g: { x: 10, y: 72 }, a: { x: 15, y: 38 } },
  { id: "store", file: "cartStore.ts", token: "state", cluster: "frontend_ui", g: { x: 27, y: 84 }, a: { x: 31, y: 38 } },
  { id: "client", file: "api.ts", token: "shared", cluster: "api_layer", g: { x: 28, y: 33 }, a: { x: 63, y: 38 } },
  { id: "routes", file: "routes.ts", token: "api", cluster: "api_layer", entry: true, g: { x: 46, y: 28 }, a: { x: 63, y: 27 } },
  { id: "auth", file: "auth.ts", token: "api", cluster: "api_layer", g: { x: 46, y: 56 }, a: { x: 79, y: 27 } },
  { id: "queue", file: "queue.ts", token: "worker", cluster: "worker_layer", g: { x: 64, y: 40 }, a: { x: 63, y: 72 } },
  { id: "worker", file: "worker.ts", token: "worker", cluster: "worker_layer", g: { x: 80, y: 28 }, a: { x: 79, y: 72 } },
  { id: "config", file: "config.ts", token: "config", cluster: "worker_layer", g: { x: 88, y: 44 }, a: { x: 63, y: 83 } },
  { id: "orders", file: "orders.ts", token: "data", cluster: "database_layer", g: { x: 63, y: 74 }, a: { x: 31, y: 72 } },
  { id: "db", file: "db.ts", token: "data", cluster: "database_layer", g: { x: 80, y: 60 }, a: { x: 15, y: 72 } },
];

/** "from imports to", drawn from chip center to chip center. */
export const STORY_EDGES: ReadonlyArray<{ from: string; to: string }> = [
  { from: "app", to: "client" },
  { from: "checkout", to: "client" },
  { from: "checkout", to: "store" },
  { from: "cart", to: "store" },
  { from: "client", to: "routes" },
  { from: "routes", to: "auth" },
  { from: "routes", to: "queue" },
  { from: "routes", to: "orders" },
  { from: "auth", to: "db" },
  { from: "queue", to: "worker" },
  { from: "worker", to: "config" },
  { from: "worker", to: "db" },
  { from: "orders", to: "db" },
];

/** The 2x2 architecture view; kinds must exist in CLUSTER_KIND_LABELS. */
export const STORY_CLUSTERS: ReadonlyArray<{ kind: StoryClusterKind; box: { x: number; y: number; w: number; h: number } }> = [
  { kind: "frontend_ui", box: { x: 6, y: 11, w: 41, h: 36 } },
  { kind: "api_layer", box: { x: 53, y: 11, w: 41, h: 36 } },
  { kind: "database_layer", box: { x: 6, y: 56, w: 41, h: 36 } },
  { kind: "worker_layer", box: { x: 53, y: 56, w: 41, h: 36 } },
];

export const STORY_SR_DESCRIPTION =
  "How OnboardBuddy works, as an animation: pick a GitHub repository, the analysis pipeline runs its phases, a dependency graph is drawn and clustered into an architecture map, and a tutorial walks one real code path with citations.";
