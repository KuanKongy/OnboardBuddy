import crypto from "node:crypto";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_test_key_placeholder";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
process.env.TOKEN_ENCRYPTION_KEY =
  process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
process.env.GITHUB_APP_ID = process.env.GITHUB_APP_ID || "123456";
process.env.GITHUB_APP_PRIVATE_KEY_PATH =
  process.env.GITHUB_APP_PRIVATE_KEY_PATH || "/dev/null";
