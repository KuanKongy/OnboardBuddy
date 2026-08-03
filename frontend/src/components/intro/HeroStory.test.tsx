import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { CLUSTER_KIND_LABELS } from "@/lib/architectureData";
import { PHASE_ORDER } from "@/lib/pipelinePhases";
import { HeroStory } from "./HeroStory";
import { STORY_ANALYSIS_STEPS, STORY_CLUSTERS, STORY_SCENES } from "./heroStoryData";

/** The stage's current scene id. */
function currentScene(): string | null {
  return document.querySelector(".story-stage")?.getAttribute("data-scene") ?? null;
}

/** matchMedia stub; the global test setup forces reduced-motion ON, and the
 *  playing-branch tests here need it OFF. */
function stubMatchMedia(reducedMotion: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: /prefers-reduced-motion/.test(query) ? reducedMotion : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const realMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("hero story data honesty", () => {
  it("maps every analysis step to a real pipeline phase key", () => {
    for (const step of STORY_ANALYSIS_STEPS) {
      expect(
        PHASE_ORDER.some((phase) => phase.key === step.phaseKey),
        `phase key ${step.phaseKey}`,
      ).toBe(true);
    }
  });

  it("uses only real architecture cluster kinds", () => {
    for (const cluster of STORY_CLUSTERS) {
      expect(CLUSTER_KIND_LABELS[cluster.kind], cluster.kind).toBeDefined();
    }
  });
});

describe("HeroStory playback", () => {
  beforeEach(() => {
    stubMatchMedia(false);
    vi.useFakeTimers();
  });

  it("advances through all five scenes and loops", () => {
    render(<HeroStory />);
    expect(currentScene()).toBe(STORY_SCENES[0]!.id);
    for (let i = 0; i < STORY_SCENES.length; i++) {
      act(() => {
        vi.advanceTimersByTime(STORY_SCENES[i]!.duration);
      });
      expect(currentScene()).toBe(STORY_SCENES[(i + 1) % STORY_SCENES.length]!.id);
    }
  });

  it("arms exactly one timer under StrictMode's double mount", () => {
    render(
      <StrictMode>
        <HeroStory />
      </StrictMode>,
    );
    // A leaked duplicate timer would fire a second advance at the same
    // timestamp and skip a scene.
    act(() => {
      vi.advanceTimersByTime(STORY_SCENES[0]!.duration + 10);
    });
    expect(currentScene()).toBe(STORY_SCENES[1]!.id);
  });

  it("pauses and resumes from the pause button", () => {
    render(<HeroStory />);
    const pause = screen.getByRole("button", { name: "Pause story" });
    fireEvent.click(pause);
    expect(pause).toHaveAttribute("aria-pressed", "true");
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(currentScene()).toBe(STORY_SCENES[0]!.id);

    fireEvent.click(screen.getByRole("button", { name: "Play story" }));
    act(() => {
      vi.advanceTimersByTime(STORY_SCENES[0]!.duration);
    });
    expect(currentScene()).toBe(STORY_SCENES[1]!.id);
  });

  it("jumps on a dot click and restarts that scene's full duration", () => {
    render(<HeroStory />);
    fireEvent.click(screen.getByRole("button", { name: `Scene 4: ${STORY_SCENES[3]!.title}` }));
    expect(currentScene()).toBe(STORY_SCENES[3]!.id);
    act(() => {
      vi.advanceTimersByTime(STORY_SCENES[3]!.duration - 5);
    });
    expect(currentScene()).toBe(STORY_SCENES[3]!.id);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(currentScene()).toBe(STORY_SCENES[4]!.id);
  });

  it("pauses while the tab is hidden", () => {
    render(<HeroStory />);
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(currentScene()).toBe(STORY_SCENES[0]!.id);

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    fireEvent(document, new Event("visibilitychange"));
    act(() => {
      vi.advanceTimersByTime(STORY_SCENES[0]!.duration);
    });
    expect(currentScene()).toBe(STORY_SCENES[1]!.id);

    if (descriptor) Object.defineProperty(Document.prototype, "visibilityState", descriptor);
    else Reflect.deleteProperty(document, "visibilityState");
  });

  it("pauses while scrolled offscreen", () => {
    type IoCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
    const instances: IoCallback[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IoCallback) {
          instances.push(callback);
        }
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );
    render(<HeroStory />);
    act(() => {
      for (const callback of instances) callback([{ isIntersecting: true }]);
    });
    act(() => {
      vi.advanceTimersByTime(STORY_SCENES[0]!.duration);
    });
    expect(currentScene()).toBe(STORY_SCENES[1]!.id);

    act(() => {
      for (const callback of instances) callback([{ isIntersecting: false }]);
    });
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(currentScene()).toBe(STORY_SCENES[1]!.id);
  });
});

describe("HeroStory under reduced motion", () => {
  it("renders a still with dots but no pause button and never auto-advances", () => {
    // The global setup's matchMedia mock already reports reduced motion, but
    // be explicit so this test doesn't depend on setup internals.
    stubMatchMedia(true);
    vi.useFakeTimers();
    render(<HeroStory />);
    expect(screen.queryByRole("button", { name: /pause story|play story/i })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(currentScene()).toBe(STORY_SCENES[0]!.id);

    fireEvent.click(screen.getByRole("button", { name: `Scene 3: ${STORY_SCENES[2]!.title}` }));
    expect(currentScene()).toBe(STORY_SCENES[2]!.id);
  });
});
