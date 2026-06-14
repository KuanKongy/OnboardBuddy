import { Router } from "express";
import {
  getAppInfo,
  listAppInstallations,
  getInstallationToken,
  listInstallationRepos,
  listBranches,
} from "../../lib/github.js";

export const githubRouter = Router();

githubRouter.get("/app", async (_req, res) => {
  try {
    const info = await getAppInfo();
    res.json({
      name: info.name,
      slug: info.slug,
      install_url: `https://github.com/apps/${info.slug}/installations/new`,
    });
  } catch (err) {
    console.error("Get app info error:", err);
    res.status(500).json({ error: "Failed to fetch GitHub App info" });
  }
});

githubRouter.get("/installations", async (_req, res) => {
  try {
    const installations = await listAppInstallations();
    res.json({ installations });
  } catch (err) {
    console.error("List installations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

githubRouter.get("/repos", async (req, res) => {
  try {
    const installationId = Number(req.query.installation_id);
    if (!installationId) {
      res.status(400).json({ error: "installation_id query parameter is required" });
      return;
    }

    const installationToken = await getInstallationToken(installationId);
    const repos = await listInstallationRepos(installationToken);
    res.json({
      repos: repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        owner: repo.owner.login,
        private: repo.private,
        default_branch: repo.default_branch,
      })),
    });
  } catch (err) {
    console.error("List repos error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

githubRouter.get("/repos/:owner/:repo/branches", async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const installationId = Number(req.query.installation_id);
    if (!installationId) {
      res.status(400).json({ error: "installation_id query parameter is required" });
      return;
    }

    const installationToken = await getInstallationToken(installationId);
    const branches = await listBranches(installationToken, owner, repo);
    res.json({ branches });
  } catch (err) {
    console.error("List branches error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
