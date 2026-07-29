import { globSync, readFileSync } from "node:fs";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

/**
 * Bug #84 — "the Files ⇄ Classes toggle needs two clicks".
 *
 * The mechanism was inferred for a whole milestone and the first fix missed
 * because of it: `pointer-events-none` went on `TooltipContent`, but Radix
 * portals that content inside its own `[data-radix-popper-content-wrapper]`,
 * which keeps `pointer-events: auto`. Live verification confirmed it —
 * `document.elementFromPoint` over the toggle returned that wrapper DIV, and
 * clicking the covered part of the button failed 3/3 while the uncovered part
 * of the same button, with the same tooltip open, worked first time.
 *
 * jsdom does no layout, so it cannot reproduce a hit test. What it *can* pin is
 * the two facts the fix depends on, both of which a future edit could quietly
 * undo.
 */

/**
 * Radix's Select uses Pointer Events capture and `scrollIntoView`, neither of
 * which jsdom implements. Scoped to this file so no other suite inherits a
 * fake pointer API.
 */
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

describe("tooltip pointer-events (#84)", () => {
  it("makes Radix's popper wrapper non-interactive, not just the content", async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>An explanation</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    await userEvent.hover(screen.getByText("Hover me"));

    const content = await waitFor(() => {
      const el = document.querySelector('[data-slot="tooltip-content"]');
      if (!el) throw new Error("tooltip did not open");
      return el as HTMLElement;
    });

    const wrapper = content.parentElement!;
    expect(wrapper.hasAttribute("data-radix-popper-content-wrapper")).toBe(true);
    // The regression this guards: styling only the inner box leaves an
    // invisible click-absorbing rectangle exactly where the tooltip appears.
    expect(wrapper.style.pointerEvents).toBe("none");
  });

  it("leaves other Radix poppers interactive — a Select can still be opened and chosen from", async () => {
    // The regression the `:has()` scoping in styles.css guards, checked here
    // rather than trusted: dropdown-menu and select render into the SAME
    // `[data-radix-popper-content-wrapper]`, and killing pointer events on it
    // would make every dropdown in the app unclickable.
    const onValueChange = vi.fn();
    render(
      <TooltipProvider>
        <Select onValueChange={onValueChange}>
          <SelectTrigger aria-label="Role">
            <SelectValue placeholder="Pick one" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="backend">Backend</SelectItem>
            <SelectItem value="frontend">Frontend</SelectItem>
          </SelectContent>
        </Select>
      </TooltipProvider>,
    );

    await userEvent.click(screen.getByLabelText("Role"));
    const option = await screen.findByRole("option", { name: "Frontend" });

    const wrapper = option.closest("[data-radix-popper-content-wrapper]") as HTMLElement | null;
    // Whatever we do to tooltips must not reach this wrapper.
    expect(wrapper?.style.pointerEvents ?? "").not.toBe("none");

    await userEvent.click(option);
    expect(onValueChange).toHaveBeenCalledWith("frontend");
  });

  it("no TooltipContent in the app contains anything clickable", () => {
    // The premise that makes the fix safe app-wide. If someone ever puts a
    // button or link inside a tooltip, `pointer-events: none` silently makes
    // it unreachable — so that has to fail here rather than in a user's hands.
    const files = globSync("src/**/*.tsx");
    const offenders: string[] = [];

    for (const file of files) {
      if (file.endsWith("tooltip.interactive.test.tsx")) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<TooltipContent\b[\s\S]*?<\/TooltipContent>/g)) {
        if (/<Button|<Link\b|<a\s|<button|onClick/.test(match[0])) {
          offenders.push(`${file}: ${match[0].slice(0, 80)}…`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
