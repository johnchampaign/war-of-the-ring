// Tiny scheduled Worker: pings the Pages sweep endpoint on a cron. Holds NO
// secrets — the Pages Function has the Supabase/Resend credentials. (Pattern
// from the Axis & Allies / Star Wars Rebellion ports; Cloudflare Pages has no
// native cron, so a separate Worker drives it.)
// Deploy: npx wrangler deploy --config workers/reminder-cron/wrangler.toml
export interface Env {
  SWEEP_URL: string;
  CRON_KEY?: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await fetch(env.SWEEP_URL, {
      method: 'POST',
      headers: env.CRON_KEY ? { 'x-cron-key': env.CRON_KEY } : {},
    });
  },
};
