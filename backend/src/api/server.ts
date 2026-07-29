import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import "dotenv/config";
import { createApp } from "./app.js";
import { checkGitHubAppConfig } from "../lib/github.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

// Bug #3: a missing github-app.pem used to be invisible until someone opened
// the import wizard and got a bare 500. Say it once at boot, with the reason
// — but do not exit: everything that is not the GitHub integration still
// works, and a hard failure here would take the whole API down over one
// feature.
const githubApp = checkGitHubAppConfig();
if (!githubApp.ok) {
  console.warn(`[api] GitHub integration unavailable — ${githubApp.reason}`);
}

app.listen(port, () => {
  console.log(`OnboardBuddy API listening on http://localhost:${port}`);
});
