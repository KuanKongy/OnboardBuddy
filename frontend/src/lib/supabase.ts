import { createClient } from "@supabase/supabase-js";
import { runtimeConfig } from "./runtimeConfig";

// Values come from runtime configuration, not from `import.meta.env` baked into
// the bundle (see runtimeConfig.ts). `main.tsx` checks `missingConfigKeys`
// before it imports anything that reaches this module, so by the time this runs
// the values are known-present; `createClient("")` throwing here is the
// deliberate loud failure for any path that skips that check.
export const supabase = createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey);
