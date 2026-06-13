// Globals injected at build time + the public client env the standard kit reads.
// __DBF_BUILD_ID__ is defined by the framework's `versionStamp` vite plugin
// (vite.config.ts) and consumed by the UpdateBanner. The VITE_SUPABASE_* values
// are the PUBLIC Supabase url + anon key — safe in the client bundle; they enable
// realtime push (subscribeSupabaseRealtime). When unset, the app polls instead.
declare const __DBF_BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
