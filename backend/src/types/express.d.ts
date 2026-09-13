declare namespace Express {
  interface Request {
    user?: { id: string; email: string };
    /** Resolved daily-credit status, set by requireDailyCredit for the handler. */
    credit?: import("../api/services/creditGate.js").CreditStatus;
    projectMember?: {
      project_id: string;
      user_id: string;
      permission_tier: string;
      developer_role: string;
      default_package_id: string | null;
    };
  }
}
