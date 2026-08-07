import { expect } from "chai";
import { languageDisplayName } from "../../src/api/lib/languageDisplay.js";

/**
 * The reader colours these names with GitHub's linguist palette, which is
 * keyed by GitHub's exact spelling — "Typescript" or "Csharp" renders without
 * a colour dot and nothing errors. These are the slugs whose display name is
 * NOT what capitalizing the first letter would give.
 */
describe("languageDisplayName", () => {
  it("spells the inventory slugs the way GitHub does", () => {
    const expected: Record<string, string> = {
      typescript: "TypeScript",
      javascript: "JavaScript",
      csharp: "C#",
      cpp: "C++",
      php: "PHP",
      html: "HTML",
      css: "CSS",
    };
    for (const [slug, name] of Object.entries(expected)) {
      expect(languageDisplayName(slug), slug).to.equal(name);
    }
  });

  it("capitalizes an unmapped slug rather than dropping it", () => {
    expect(languageDisplayName("zig")).to.equal("Zig");
    expect(languageDisplayName("")).to.equal("");
  });
});
