import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsShell, type SettingsSection } from "./SettingsShell";

beforeAll(() => {
  // jsdom implements neither, and the rail scrolls on click.
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView ??= () => {};
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
});
