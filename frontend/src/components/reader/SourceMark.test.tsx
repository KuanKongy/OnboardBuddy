import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SourceMark } from "./SourceMark";

/**
 * The mark is the app's one answer to "who wrote this", and it is now read off
 * a served field rather than guessed — so the failure this guards is silent:
 * a chip that renders the wrong tone, or renders its explanatory sentence
 * nowhere, still looks fine on screen and still lies about provenance.
 *
 * Two things are pinned. `data-source` is the machine-readable tone, which is
 * what every call site is really choosing between; and the tooltip actually
 * opening with the caller's sentence, because the whole point of the chip
 * variant is that the short label is visible and the sentence is one hover
 * away — a chip whose tooltip never opens is a label with its reason deleted.
 */
function mount(ui: React.ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("SourceMark", () => {
  it("renders the two tones with distinct labels and machine-readable sources", () => {
    mount(
      <>
        <SourceMark source="ai" />
        <SourceMark source="code" />
      </>,
    );

    const ai = screen.getByText(/^AI$/);
    const code = screen.getByText(/^From code$/);
    expect(ai).toHaveAttribute("data-source", "ai");
    expect(code).toHaveAttribute("data-source", "code");
  });

  it("shows the caller's sentence on hover, not the tone's default", async () => {
    mount(<SourceMark source="code" tip="Arithmetic over traced signals. No model involved." />);

    await userEvent.hover(screen.getByText(/^From code$/));

    await waitFor(() => {
      // Radix renders the open tooltip's text twice (visible box + the
      // aria-live announcement), so this asserts presence, not a single node.
      expect(
        screen.getAllByText("Arithmetic over traced signals. No model involved.").length,
      ).toBeGreaterThan(0);
    });
    expect(
      screen.queryByText("Derived from the traced structure of the code. No AI involved."),
    ).not.toBeInTheDocument();
  });

  it("appends the visible detail suffix without touching the label", () => {
    mount(<SourceMark source="ai" detail="high confidence" />);

    const chip = screen.getByText(/^AI$/);
    expect(chip).toHaveTextContent("AI· high confidence");
  });

  it("falls back to a glyph with a native title in the icon variant", () => {
    const { container } = mount(<SourceMark source="ai" variant="icon" tip="Model-written note." />);

    // No pill, no tooltip machinery — the dense-context variant is an svg whose
    // title is the only carrier of the sentence.
    expect(container.querySelector("[data-source]")).toBeNull();
    expect(container.querySelector("svg title")?.textContent).toBe("Model-written note.");
  });
});
