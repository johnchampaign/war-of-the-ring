#!/usr/bin/env vite-node
// One-shot check that realtime push is live: subscribe with the framework client
// (same call the UI makes), then post a chat through the deployed API and confirm
// the server's broadcaster pings the subscription. Run: vite-node scripts/probe-realtime.mjs
import { subscribeSupabaseRealtime } from 'digital-boardgame-framework/client/realtime';

const SB_URL = 'https://nuvhxfrqutbfcvozfwrn.supabase.co';
const ANON = process.env.ANON;
const API = 'https://war-of-the-ring.pages.dev/api';
const UA = { 'user-agent': 'Mozilla/5.0', 'content-type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const create = await fetch(`${API}/games`, { method: 'POST', headers: UA }).then((r) => r.json());
const gid = create.gameId;
const fpTok = new URL(create.invites.fp).searchParams.get('as');
console.log('game', gid);

let fired = 0;
const unsub = subscribeSupabaseRealtime({ supabaseUrl: SB_URL, anonKey: ANON, gameId: gid, event: 'message' })(
  () => { fired++; console.log('  >> realtime callback fired'); },
);

await sleep(3500); // let the channel subscribe
console.log('posting chat (server should broadcast "message")…');
await fetch(`${API}/games/${gid}/chat?as=${fpTok}`, { method: 'POST', headers: UA, body: JSON.stringify({ message: 'realtime probe' }) });
await sleep(5000);

unsub();
console.log(fired > 0 ? `\nPASS — push delivered (${fired})` : '\nFAIL — no push received');
process.exit(fired > 0 ? 0 : 1);
