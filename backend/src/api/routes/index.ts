import { Router } from "express";
import { healthRouter } from "./health.js";
import { authRouter } from "./auth.js";
import { githubRouter } from "./github.js";
import { projectsRouter } from "./projects.js";
import { invitationsRouter } from "./invitations.js";
import { membersRouter } from "./members.js";
import { graphRouter } from "./graph.js";
import { onboardingRouter } from "./onboarding.js";
import { workflowsRouter } from "./workflows.js";
import { capabilitiesRouter } from "./capabilities.js";
import { tutorialsRouter } from "./tutorials.js";
import { progressRouter } from "./progress.js";
import { llmKeysRouter } from "./llmKeys.js";
import { askRouter } from "./ask.js";
import { internalChatRouter } from "./internalChat.js";
import { requireAuth } from "../middleware/auth.js";
import { askRateLimit } from "../middleware/askRateLimit.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/github", requireAuth, githubRouter);
apiRouter.use("/projects", requireAuth, projectsRouter);
// Two invitation surfaces on purpose: this one is the invitee's inbox, authorized
// by their own email because they are not a member yet. The project-scoped
// `/projects/:id/members/invitations` is authorized by owner/admin membership.
apiRouter.use("/invitations", requireAuth, invitationsRouter);
apiRouter.use("/projects/:id/members", requireAuth, membersRouter);
apiRouter.use("/projects/:id/graph", requireAuth, graphRouter);
apiRouter.use("/projects/:id/onboarding", requireAuth, onboardingRouter);
apiRouter.use("/projects/:id/workflows", requireAuth, workflowsRouter);
apiRouter.use("/projects/:id/capabilities", requireAuth, capabilitiesRouter);
apiRouter.use("/projects/:id/tutorials", requireAuth, tutorialsRouter);
apiRouter.use("/projects/:id/progress", requireAuth, progressRouter);
apiRouter.use("/projects/:id/llm-key", requireAuth, llmKeysRouter);
apiRouter.use("/projects/:id/ask", requireAuth, askRateLimit, askRouter);
apiRouter.use("/internal/chat", internalChatRouter);
