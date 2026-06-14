import { Router } from "express";
import { healthRouter } from "./health.js";
import { authRouter } from "./auth.js";
import { githubRouter } from "./github.js";
import { projectsRouter } from "./projects.js";
import { invitationsRouter } from "./invitations.js";
import { membersRouter } from "./members.js";
import { requireAuth } from "../middleware/auth.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/github", requireAuth, githubRouter);
apiRouter.use("/projects", requireAuth, projectsRouter);
apiRouter.use("/invitations", requireAuth, invitationsRouter);
apiRouter.use("/projects/:id/members", requireAuth, membersRouter);
