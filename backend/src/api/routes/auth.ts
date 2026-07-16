import { Router } from "express";
import { supabaseAdmin } from "../../lib/supabase.js";
import { pool, query } from "../../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { deleteAccountTx, deleteAuthUser } from "../services/accountDeletion.js";

export const authRouter = Router();

authRouter.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      const status = error.message.includes("already") ? 409 : 422;
      res.status(status).json({ error: error.message });
      return;
    }

    res.status(201).json({ user: { id: data.user.id, email: data.user.email } });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      res.status(401).json({ error: error.message });
      return;
    }

    res.json({
      user: { id: data.user.id, email: data.user.email },
      session: { access_token: data.session.access_token },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  try {
    const token = req.headers.authorization!.slice(7);
    const { error } = await supabaseAdmin.auth.admin.signOut(token);

    if (error) {
      res.status(422).json({ error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Permanent account deletion: application rows first (one transaction), then
 * the Supabase auth user. If the auth deletion fails after the commit, the
 * client retries — the row deletes are idempotent and sign-in still works
 * until the auth user is actually gone.
 */
authRouter.delete("/account", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deleteAccountTx(client, userId);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Account deletion error:", err);
    res.status(500).json({ error: "Internal server error" });
    return;
  } finally {
    client.release();
  }

  try {
    // "already_gone" is success too: stateless JWT verification means a
    // session can outlive its auth user (earlier attempt, dashboard delete).
    await deleteAuthUser(userId);
  } catch (err) {
    console.error("Auth user deletion failed after data wipe:", err);
    res.status(500).json({ error: "Account data deleted, but removing the sign-in failed — please retry" });
    return;
  }

  res.status(204).send();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const result = await query(
      `SELECT u.id, u.email, u.created_at,
              gc.github_username,
              CASE WHEN gc.id IS NOT NULL THEN true ELSE false END AS github_connected
       FROM public.users u
       LEFT JOIN public.github_connections gc ON gc.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const row = result.rows[0] as {
      id: string;
      email: string;
      created_at: string;
      github_connected: boolean;
      github_username: string | null;
    };

    res.json({
      user: {
        id: row.id,
        email: row.email,
        created_at: row.created_at,
        github_connected: row.github_connected,
        github_username: row.github_username,
      },
    });
  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
