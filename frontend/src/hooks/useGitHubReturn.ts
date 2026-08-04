import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";

/**
 * Where a GitHub round trip should land afterwards. Written by
 * `connectGithub(next)` before leaving; read (and cleared once consumed) by
 * the return handler. sessionStorage on purpose: the target is meaningful
 * only to the tab that left.
 */
export const GITHUB_NEXT_KEY = "onboardbuddy.github.next";

export type GitHubReturnPhase =
  | "working"
  | "pending"
  | "updated"
  | "needsConnect"
  | "error";

export interface GitHubReturnState {
  phase: GitHubReturnPhase;
  error: string;
  /** Validated in-app path to land on (or link back to) after this round trip. */
  next: string;
}

function readError(params: URLSearchParams): string {
  const code = params.get("error");
  if (!code) return "";
  if (code === "access_denied") return "You cancelled on GitHub.";
  return params.get("error_description")?.replace(/\+/g, " ") ?? code;
}

/**
 * One handler for every way GitHub can send a user back to the app. With
 * "Request user authorization (OAuth) during installation" enabled, installs
 * return to the CALLBACK URL carrying `code+installation_id+setup_action
 * (+state when the visit started from an in-app install link)`; legacy
 * arrivals (settings not flipped) hit the Setup URL with `installation_id+
 * state`; GitHub-initiated installs/updates arrive with no state at all.
 * Both /github/oauth/callback and /github/setup render through this hook, so
 * every shape works no matter which URL GitHub picks.
 *
 * The state token is a stateless user-bound HMAC (15-min TTL, no replay
 * store), so the single token minted into the install URL legally serves
 * both endpoint calls. Order matters: oauth/complete saves the connection
 * that installations/link's access check reads.
 */
export function useGitHubReturn(): GitHubReturnState {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<GitHubReturnPhase>("working");
  const [error, setError] = useState("");
  // Read WITHOUT clearing: StrictMode mounts twice and the second mount must
  // see the same target. Cleared once the flow actually consumes it.
  const [next] = useState(() => {
    const raw = sessionStorage.getItem(GITHUB_NEXT_KEY);
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/import";
  });
  const requestedRef = useRef(false);

  useEffect(() => {
    const denial = readError(params);
    if (denial) {
      setError(denial);
      setPhase("error");
      return;
    }
    // A member without install permission can only *request* the app; an org
    // owner must approve. There is no installation yet, and nothing failed.
    if (params.get("setup_action") === "request") {
      setPhase("pending");
      return;
    }

    // Guard against StrictMode's dev double-invoke re-firing the single-use
    // OAuth code, which would flip a successful connection into an error on
    // the second (failing) attempt.
    if (requestedRef.current) return;
    requestedRef.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const installationId = params.get("installation_id");

    void (async () => {
      try {
        if (code && state) {
          // Combined install+authorize (or plain re-authorize when no
          // installation_id): complete first, it saves the connection the
          // link's access check needs.
          await apiFetch("/github/oauth/complete", {
            method: "POST",
            body: JSON.stringify({ code, state }),
          });
          if (installationId) {
            await apiFetch("/github/installations/link", {
              method: "POST",
              body: JSON.stringify({ installation_id: installationId, state }),
            });
          }
          sessionStorage.removeItem(GITHUB_NEXT_KEY);
          navigate(next, { replace: true });
          return;
        }

        if (state && installationId) {
          // Legacy install arrival: App settings without OAuth-during-install.
          try {
            await apiFetch("/github/installations/link", {
              method: "POST",
              body: JSON.stringify({ installation_id: installationId, state }),
            });
          } catch (err) {
            // Straight-to-install with no prior connection: the link's access
            // check has no user token to verify with. Finish via the pure
            // authorize hop instead of surfacing a bare 403.
            const info = (await apiFetch("/github/installations").catch(() => null)) as {
              github_connected?: boolean;
            } | null;
            if (info && info.github_connected === false) {
              setPhase("needsConnect");
              return;
            }
            throw err;
          }
          sessionStorage.removeItem(GITHUB_NEXT_KEY);
          navigate(next, { replace: true });
          return;
        }

        if (installationId) {
          // GitHub-initiated (install or repository change started on
          // github.com): no state to verify and nothing to link — the
          // installations list is read live from the GitHub API, so the
          // change is already visible in the app.
          setPhase("updated");
          return;
        }

        setError("GitHub did not return the expected parameters.");
        setPhase("error");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();
  }, [navigate, params, next]);

  return { phase, error, next };
}
