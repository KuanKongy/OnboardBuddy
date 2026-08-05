import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsShell, type SettingsSection } from "./SettingsShell";

beforeAll(() => {
  // jsdom implements neither, and the rail scrolls on click. Both branches are
  // stubbed even though the matchMedia stub in src/test/setup.ts reports
  // `matches: false`, so clicks here always take the mobile scrollIntoView path.
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView ??= () => {};
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});

const sections: SettingsSection[] = [
  { id: "settings-general", label: "General", children: <p>repository facts</p> },
  { id: "settings-danger", label: "Danger zone", children: <p>delete this project</p> },
];

describe("SettingsShell", () => {
  it("renders one rail link and one h2 per section, with that section's content", () => {
    render(<SettingsShell sections={sections} />);

    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "General",
      "Danger zone",
    ]);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "General",
      "Danger zone",
    ]);
    expect(screen.getByText("repository facts")).toBeInTheDocument();
    expect(screen.getByText("delete this project")).toBeInTheDocument();
  });

  it("marks the clicked section as current", async () => {
    const user = userEvent.setup();
    render(<SettingsShell sections={sections} />);
    const rail = screen.getByRole("navigation", { name: "Settings sections" });

    expect(within(rail).getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "true");

    await user.click(within(rail).getByRole("button", { name: "Danger zone" }));

    expect(within(rail).getByRole("button", { name: "Danger zone" })).toHaveAttribute("aria-current", "true");
    expect(within(rail).getByRole("button", { name: "General" })).not.toHaveAttribute("aria-current");
  });

  it("renders the footer in the scrolling column, after the last section", () => {
    // The save bar is only mounted when there is something to save, so it no
    // longer needs a pinned row of its own: it rides the column and appears
    // right below the sections the edit was made in.
    render(<SettingsShell sections={sections} footer={<button type="button">Save changes</button>} />);

    const save = screen.getByRole("button", { name: "Save changes" });
    const column = screen.getByText("repository facts").closest("section")!.parentElement!;

    expect(column).toContainElement(document.getElementById("settings-danger"));
    expect(column).toContainElement(save);
    expect(column.lastElementChild).toContainElement(save);
  });

  it("follows scrolling via the observer, so the rail is right even when a short last section can't reach the top", async () => {
    type IoCallback = (entries: Array<{ isIntersecting: boolean; boundingClientRect: { top: number }; target: { id: string } }>) => void;
    const callbacks: IoCallback[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IoCallback) {
          callbacks.push(callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );
    try {
      const { act } = await import("@testing-library/react");
      render(<SettingsShell sections={sections} />);
      const rail = screen.getByRole("navigation", { name: "Settings sections" });

      act(() => {
        for (const callback of callbacks) {
          callback([
            { isIntersecting: true, boundingClientRect: { top: 40 }, target: { id: "settings-danger" } },
          ]);
        }
      });

      expect(within(rail).getByRole("button", { name: "Danger zone" })).toHaveAttribute("aria-current", "true");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
