declare namespace Express {
  interface Request {
    user?: { id: string; email: string };
    projectMember?: {
      project_id: string;
      user_id: string;
      permission_tier: string;
      developer_role: string;
    };
  }
}
