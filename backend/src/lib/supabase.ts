import { createClient } from "@supabase/supabase-js";

function normalizeSupabaseUrl(url: string): string {
  return url.replace(/\/$/, "").replace(/\/rest\/v1\/?$/, "").trim();
}

const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL ?? "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

if (serviceRoleKey.startsWith("sb_publishable_")) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY looks like a publishable key. Use the secret key (sb_secret_...) from Supabase Settings > API Keys.",
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
