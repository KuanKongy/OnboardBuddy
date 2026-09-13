import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LivingBackground } from "@/components/intro/LivingBackground";
import { PublicPageShell } from "./PublicPageShell";

/**
 * Public content pages share the intro background, but with the aurora lights
 * off: the dot grid and vignette give them the base mesh while the three
 * colored blobs stay on the landing page only. This pins that the shell renders
 * its content and composes LivingBackground down the showLights={false} path
 * (no blobs), with a direct render confirming the default keeps them.
 */

const authState = vi.hoisted(() => ({
  current: { user: null as { id: string } | null, loading: false, signOut: vi.fn() },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authState.current,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe("PublicPageShell", () => {
  it("renders its content with the base mesh but no aurora blobs", () => {
    render(
      <MemoryRouter>
        <PublicPageShell title="Sample" subtitle="A public page">
          <p>Body content</p>
        </PublicPageShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Sample" })).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
    // The three colored aurora blobs are the "lights"; the shell turns them off.
    expect(screen.queryAllByTestId("aurora-blob")).toHaveLength(0);
  });

  it("keeps the three aurora blobs when LivingBackground is used with lights on", () => {
    render(<LivingBackground />);

    expect(screen.getAllByTestId("aurora-blob")).toHaveLength(3);
  });
});
