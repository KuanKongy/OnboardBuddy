// Runtime configuration placeholder — intentionally defines nothing.
//
// In a container this file is REPLACED at startup by
// frontend/docker-entrypoint.d/10-onboardbuddy-runtime-config.sh, which writes
//
//     window.__ONBOARDBUDDY_CONFIG__ = { apiUrl: …, supabaseUrl: …, supabaseAnonKey: … };
//
// from the process environment. That is what lets one built image serve any API
// origin (issue #73); see frontend/src/lib/runtimeConfig.ts.
//
// It ships empty so that:
//   * `npm run dev` and `vite preview` serve a real file instead of a 404 that
//     the browser would try to parse as JavaScript, and
//   * with the global absent, the app falls back to Vite's build-time
//     import.meta.env.VITE_* from frontend/.env — the local dev path, unchanged.
//
// Never put values here. Anything committed to this file would be baked into
// the image and would shadow the deployment's real configuration.
