// Market-data ticker: flush coalesced L2 snapshots every 100ms.
//
// All market-data LOGIC lives in PG (broadcast_md coalesces dirty books and calls
// realtime.send). Only the 100ms timer is external, because pg_cron can't go
// sub-second. The trade tape needs no ticker — it's pushed by an AFTER INSERT
// trigger. A pure-PG fallback at 1s is registered via pg_cron in 9640/9720.
//
//   SERVICE=<service_role key> node examples/md-ticker.mjs
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.API ?? "http://127.0.0.1:54321", process.env.SERVICE);

const INTERVAL_MS = Number(process.env.TICK_MS ?? 100);
let running = false;
setInterval(async () => {
  if (running) return;           // skip if a flush is still in flight
  running = true;
  try {
    const { data, error } = await sb.rpc("broadcast_md");
    if (error) console.error("broadcast_md:", error.message);
    else if (data > 0) console.log(`flushed ${data} book(s)`);
  } finally { running = false; }
}, INTERVAL_MS);

console.log(`md ticker running every ${INTERVAL_MS}ms; Ctrl-C to stop`);
