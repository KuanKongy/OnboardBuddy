import { describe, expect, it } from "vitest";
import {
  decodeDrill,
  encodeDrill,
  framesFromLegacyCluster,
  sameFrames,
  type DrillFrame,
} from "./drillStack";

const frame = (kind: DrillFrame["kind"], id: string, label = id): DrillFrame => ({ kind, id, label });

describe("drill encoding", () => {
  it("round-trips a multi-level path", () => {
    const frames = [frame("cluster", "src/lib", "lib"), frame("file", "src/lib/api.ts", "api.ts")];
    expect(decodeDrill(encodeDrill(frames))).to.deep.equal(frames);
  });

  it("survives ids containing the delimiters or lookalikes", () => {
    // Real paths contain all of these. `~` is the trap: encodeURIComponent
    // leaves it untouched (RFC 3986 unreserved), so using it as a field
    // delimiter tore this id into two frames.
    const frames = [frame("file", "src/weird~name|v2,final.ts", "weird~name|v2,final.ts")];
    const encoded = encodeDrill(frames);
    expect(decodeDrill(encoded)).to.deep.equal(frames);
    // Exactly two field delimiters and no frame delimiter: one frame, 3 fields.
    expect(encoded.split(",")).to.have.length(3);
    expect(encoded).to.not.contain("|");
  });

  it("decodes an empty or absent param as the root level", () => {
    expect(decodeDrill(null)).to.deep.equal([]);
    expect(decodeDrill("")).to.deep.equal([]);
  });

  it("drops unparseable frames instead of throwing", () => {
    // A hand-edited URL should land the user shallower, never blank the page.
    const good = encodeDrill([frame("cluster", "src", "src")]);
    expect(decodeDrill(`${good}|garbage|nosuchkind,x,y|cluster,`)).to.deep.equal([
      frame("cluster", "src", "src"),
    ]);
  });

  it("defaults a missing label to the id", () => {
    expect(decodeDrill("cluster,src%2Flib")).to.deep.equal([frame("cluster", "src/lib", "src/lib")]);
  });
});

describe("legacy ?cluster= migration", () => {
  it("becomes a single cluster frame labelled by its last segment", () => {
    expect(framesFromLegacyCluster("src/components/graph")).to.deep.equal([
      { kind: "cluster", id: "src/components/graph", label: "graph" },
    ]);
  });

  it("is the root level when absent", () => {
    expect(framesFromLegacyCluster(null)).to.deep.equal([]);
    expect(framesFromLegacyCluster("")).to.deep.equal([]);
  });
});

describe("sameFrames", () => {
  it("compares kind and id, ignoring label drift", () => {
    expect(sameFrames([frame("cluster", "a", "A")], [frame("cluster", "a", "renamed")])).to.equal(true);
    expect(sameFrames([frame("cluster", "a")], [frame("file", "a")])).to.equal(false);
    expect(sameFrames([frame("cluster", "a")], [frame("cluster", "a"), frame("file", "b")])).to.equal(false);
  });
});

describe("the ladder the old path-segment logic could not express", () => {
  it("keeps levels that are not path prefixes of one another", () => {
    // `segments.slice(0,-1)` assumed every level was a prefix of the next.
    // cluster -> file -> symbols is not, and neither is workflow -> step.
    const frames = [
      frame("workflow", "wf-42", "Sign in"),
      frame("step", "src/auth/login.ts#login", "login"),
      frame("callees", "src/auth/login.ts#login", "callees"),
    ];
    expect(decodeDrill(encodeDrill(frames))).to.deep.equal(frames);
  });
});
