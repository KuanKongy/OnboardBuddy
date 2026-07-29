import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConfigErrorScreen } from "./components/ConfigErrorScreen";
import { missingConfigKeys } from "./lib/runtimeConfig";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);

if (missingConfigKeys.length > 0) {
  // `./App` is imported dynamically, and only on this branch's `else`, on
  // purpose. Its module graph reaches `lib/supabase`, whose `createClient("")`
  // throws while modules are still evaluating — with a static import that
  // throw happens before any line of this file runs, and the deployment gets a
  // blank page instead of an explanation (issue #73).
  root.render(<ConfigErrorScreen missing={missingConfigKeys} />);
} else {
  void import("./App")
    .then(({ default: App }) => {
      root.render(
        <StrictMode>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </StrictMode>,
      );
    })
    .catch((error: unknown) => {
      // A chunk that 404s (stale index.html against a new deploy) would also be
      // a blank page. Say so rather than showing nothing.
      console.error("Failed to load the application bundle", error);
      root.render(<ConfigErrorScreen missing={[]} />);
    });
}
