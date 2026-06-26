// Reference: how a logged-in frontend subscribes to its PRIVATE realtime feed.
//
// No server code, no per-user channel plumbing: Supabase Realtime "Postgres
// Changes" evaluates the table RLS per subscriber, so authenticating the realtime
// socket with the user's JWT is enough — the client only ever receives rows it is
// allowed to see (its own orders, fills, wallet requests).
//
//   npm i @supabase/supabase-js
//   ANON=<anon key> JWT=<user access token> node examples/private-feed.mjs
import { createClient } from "@supabase/supabase-js";

const API = process.env.API ?? "http://127.0.0.1:54321";
const sb = createClient(API, process.env.ANON);

// 1) authenticate the realtime socket as this user (this is what scopes RLS)
await sb.realtime.setAuth(process.env.JWT);          // e.g. session.access_token

// 2) subscribe to your private streams. RLS on trade_order / wallet_request means
//    you receive ONLY your own rows; no topic/userId wiring required.
sb.channel("me:orders")
  .on("postgres_changes", { event: "*", schema: "public", table: "trade_order" },
      ({ eventType, new: row }) => console.log("order", eventType, row?.pub_id, row?.status, "open=", row?.open_amount))
  .subscribe();

sb.channel("me:wallet")
  .on("postgres_changes", { event: "*", schema: "public", table: "wallet_request" },
      ({ eventType, new: row }) => console.log("wallet", eventType, row?.direction, row?.amount, row?.status))
  .subscribe();

// public market data uses the same mechanism but needs no auth:
sb.channel("md:book")
  .on("postgres_changes", { event: "*", schema: "public", table: "price_level" },
      ({ new: l }) => console.log("L2", l?.side, l?.price, l?.volume))
  .subscribe();

console.log("subscribed to private order/wallet feed + public order book; Ctrl-C to exit");
