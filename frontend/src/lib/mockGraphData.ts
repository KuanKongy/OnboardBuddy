import type { AnalysisSnapshot } from "@/types/graph";

export const mockGraphData: AnalysisSnapshot = {
  projectId: "local",
  triggeredBy: "cli",
  repoIndex: {
    files: [
      { relativePath: "src/index.ts", language: "typescript", sizeBytes: 440 },
      { relativePath: "src/utils/strings.ts", language: "typescript", sizeBytes: 164 },
      { relativePath: "src/utils/logger.ts", language: "typescript", sizeBytes: 336 },
      { relativePath: "src/services/userService.ts", language: "typescript", sizeBytes: 869 },
    ],
    detectedLanguage: "typescript",
    scannedAt: "2026-06-04T05:27:59.701Z",
  },
  fileAnalyses: [
    {
      relativePath: "src/index.ts",
      symbols: [
        { name: "logger", kind: "variable", exported: false, initializer: "createLogger('dummy-ts')" },
        { name: "userService", kind: "variable", exported: false, initializer: "new UserService(logger)" },
        {
          name: "main",
          kind: "function",
          exported: false,
          signature: "() => Promise<void>",
          isAsync: true,
          callsSymbols: ["userService.listActiveUsers", "logger.info"],
        },
        { name: "users", kind: "variable", exported: false, initializer: "await userService.listActiveUsers()" },
      ],
      imports: [
        { toSpecifier: "./services/userService", namedImports: ["UserService"] },
        { toSpecifier: "./utils/logger", namedImports: ["createLogger"] },
      ],
    },
    {
      relativePath: "src/utils/strings.ts",
      symbols: [
        {
          name: "normalizeEmail",
          kind: "arrow-function",
          exported: true,
          signature: "(email: string) => string",
          parameters: [{ name: "email", type: "string" }],
          isAsync: false,
          callsSymbols: ["email.trim().toLowerCase", "email.trim"],
        },
        {
          name: "StringFormat",
          kind: "enum",
          exported: true,
          members: [
            { name: "Email", value: "email" },
            { name: "Slug", value: "slug" },
          ],
        },
      ],
      imports: [],
    },
    {
      relativePath: "src/utils/logger.ts",
      symbols: [
        {
          name: "Logger",
          kind: "interface",
          exported: true,
          properties: [
            { name: "info", type: "(message: string) => void" },
            { name: "error", type: "(message: string) => void" },
          ],
        },
        {
          name: "createLogger",
          kind: "function",
          exported: true,
          signature: "(scope: string) => Logger",
          parameters: [{ name: "scope", type: "string" }],
          isAsync: false,
          callsSymbols: ["console.log", "console.error"],
        },
      ],
      imports: [],
    },
    {
      relativePath: "src/services/userService.ts",
      symbols: [
        {
          name: "User",
          kind: "interface",
          exported: true,
          properties: [
            { name: "id", type: "string" },
            { name: "email", type: "string" },
            { name: "active", type: "boolean" },
          ],
        },
        {
          name: "UserSummary",
          kind: "type",
          exported: true,
          definition: "Pick<User, 'id' | 'email'>",
        },
        {
          name: "seedUsers",
          kind: "variable",
          exported: false,
          typeAnnotation: "User[]",
          initializer:
            "[\n  { id: 'u_001', email: 'ADA@EXAMPLE.COM', active: true },\n  { id: 'u_002', email: 'grace@example.com', active: false },\n  { id: 'u_003', email: 'linus@example.com', active: true }\n]",
        },
        {
          name: "UserService",
          kind: "class",
          exported: true,
          jsDoc: "Small service with class, methods, imports, exports, and type-only import.",
          constructors: [
            { parameters: [{ name: "logger", type: "Logger", accessibility: "private" }] },
          ],
          methods: [
            {
              name: "listActiveUsers",
              signature: "() => Promise<UserSummary[]>",
              parameters: [],
              isAsync: true,
              accessibility: "public",
            },
          ],
        },
      ],
      imports: [
        { toSpecifier: "../utils/logger", namedImports: ["Logger"], isTypeOnly: true },
        { toSpecifier: "../utils/strings", namedImports: ["normalizeEmail"] },
      ],
    },
  ],
  graph: {
    nodes: [
      {
        id: "src/index.ts",
        label: "index",
        kind: "module",
        metadata: { exportedSymbols: [], importCount: 2, dependentCount: 0 },
      },
      {
        id: "src/utils/strings.ts",
        label: "strings",
        kind: "module",
        metadata: { exportedSymbols: ["normalizeEmail", "StringFormat"], importCount: 0, dependentCount: 1 },
      },
      {
        id: "src/utils/logger.ts",
        label: "logger",
        kind: "module",
        metadata: { exportedSymbols: ["Logger", "createLogger"], importCount: 0, dependentCount: 2 },
      },
      {
        id: "src/services/userService.ts",
        label: "userService",
        kind: "module",
        metadata: { exportedSymbols: ["User", "UserSummary", "UserService"], importCount: 2, dependentCount: 1 },
      },
    ],
    edges: [
      { id: "src/index.ts→src/services/userService.ts", source: "src/index.ts", target: "src/services/userService.ts", kind: "imports" },
      { id: "src/index.ts→src/utils/logger.ts", source: "src/index.ts", target: "src/utils/logger.ts", kind: "imports" },
      { id: "src/services/userService.ts→src/utils/logger.ts", source: "src/services/userService.ts", target: "src/utils/logger.ts", kind: "imports" },
      { id: "src/services/userService.ts→src/utils/strings.ts", source: "src/services/userService.ts", target: "src/utils/strings.ts", kind: "imports" },
    ],
    entryPoints: ["src/index.ts"],
  },
  createdAt: "2026-06-04T05:27:59.936Z",
};
