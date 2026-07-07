import { deriveArchitectureGraph } from "./architectureGraph";
import { mockGraphData } from "./mockGraphData";

describe("deriveArchitectureGraph", () => {
  const architecture = deriveArchitectureGraph(
    mockGraphData.graph.nodes,
    mockGraphData.graph.edges,
    mockGraphData.graph.entryPoints,
  );

  it("groups files into one component per directory", () => {
    const ids = architecture.components.map((c) => c.id).sort();
    expect(ids).toEqual(["src", "src/services", "src/utils"]);

    const utils = architecture.components.find((c) => c.id === "src/utils")!;
    expect(utils.files).toEqual(["src/utils/strings.ts", "src/utils/logger.ts"]);
  });

  it("infers component types from directory names", () => {
    const byId = new Map(architecture.components.map((c) => [c.id, c]));
    expect(byId.get("src/services")!.type).toBe("service");
    expect(byId.get("src/utils")!.type).toBe("utility");
    // "src" contains the entry point and matches no other rule
    expect(byId.get("src")!.type).toBe("entry");
  });

  it("marks components containing entry point files", () => {
    expect(architecture.entryComponentIds).toEqual(["src"]);
  });

  it("aggregates file edges into weighted component edges", () => {
    const edgeIds = architecture.edges.map((e) => e.id).sort();
    expect(edgeIds).toEqual([
      "src/services→src/utils",
      "src→src/services",
      "src→src/utils",
    ]);

    // userService imports both logger and strings from src/utils
    const serviceToUtils = architecture.edges.find((e) => e.id === "src/services→src/utils")!;
    expect(serviceToUtils.weight).toBe(2);
  });

  it("collects exported symbols per component", () => {
    const utils = architecture.components.find((c) => c.id === "src/utils")!;
    expect(utils.exportedSymbols).toContain("normalizeEmail");
    expect(utils.exportedSymbols).toContain("createLogger");
  });
});
