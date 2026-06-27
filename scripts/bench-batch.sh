#!/usr/bin/env bash
# Tune the group-commit batch size for submit_orders, measured over the real
# client path (PostgREST/HTTP). Batching N orders into one RPC call amortizes the
# HTTP round-trip + auth + the per-instrument advisory lock + the commit across N
# orders. Throughput rises with batch size up to a knee, then falls (the longer
# single transaction holds the instrument lock and re-updates the submitter's own
# account rows N times). Per-call latency grows ~linearly. Pick the size at the knee.
#
# Usage: SERVICE=<service_role key> ./scripts/bench-batch.sh   [N=600] [SIZES="1 10 25 50 100 200"]
# Run on a QUIET box; compare rows from the same run (relative shape is robust).
set -euo pipefail
export API="${API:-http://127.0.0.1:54321}"
export SERVICE="${SERVICE:?set SERVICE (service_role key)}"
export N="${N:-600}"
export SIZES="${SIZES:-1 10 25 50 100 200}"

node -e '
const API=process.env.API, KEY=process.env.SERVICE, N=+process.env.N, SIZES=process.env.SIZES.trim().split(/\s+/).map(Number);
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,"Content-Type":"application/json"};
const rpc=(fn,b)=>fetch(`${API}/rest/v1/rpc/${fn}`,{method:"POST",headers:H,body:JSON.stringify(b)}).then(r=>r.text());
const T=Date.now();
const mk=async(n)=>{const p=JSON.parse(await rpc("create_client",{external_id_param:n}));await rpc("create_currency_account",{app_entity_id_param:p,currency_param:"BTC"});
  for(const c of["EUR","BTC"])await rpc("process_transfer",{type_param:"DEPOSIT",from_customer_id_param:"MASTER",amount_param:1e9,currency_param:c,to_customer_id_param:p,reference_param:"b",details_param:"b",fee_type_param:null});
  return JSON.parse(await rpc("find_instrument_account",{external_id_param:n}));};
const restAsks=async(M,n)=>{const o=Array.from({length:Math.min(200,n)},()=>({type:"LIMIT",side:"SELL",price:100,amount:1,tif:"GTC"}));
  for(let i=0;i<n;i+=200)await rpc("submit_orders",{instrument_account_id_param:M,instrument_name_param:"BTC_EUR",orders:o.slice(0,Math.min(200,n-i))});};
(async()=>{
  const M=await mk("bbM_"+T), K=await mk("bbK_"+T);
  console.log(`\n──── batch sweep over HTTP · N=${N} settled trades per size ────`);
  console.log("batch   HTTP calls   orders/s   per-call ms   speedup");
  console.log("-----   ----------   --------   -----------   -------");
  let base=null;
  for(const B of SIZES){
    await restAsks(M,N);
    const o=Array.from({length:B},()=>({type:"LIMIT",side:"BUY",price:100,amount:1,tif:"GTC"}));
    const calls=Math.ceil(N/B); const t=Date.now();
    if(B===1){ for(let i=0;i<N;i++) await rpc("submit_order",{instrument_account_id_param:K,instrument_name_param:"BTC_EUR",order_type_param:"LIMIT",side_param:"BUY",price_param:100,amount_param:1,time_in_force_param:"GTC"}); }
    else { for(let i=0;i<N;i+=B) await rpc("submit_orders",{instrument_account_id_param:K,instrument_name_param:"BTC_EUR",orders:o}); }
    const s=(Date.now()-t)/1000, ops=N/s; if(base===null)base=ops;
    console.log(`${String(B).padStart(5)}   ${String(calls).padStart(10)}   ${ops.toFixed(0).padStart(8)}   ${(s/calls*1000).toFixed(1).padStart(11)}   ${(ops/base).toFixed(2)}x`);
  }
  console.log("\nPick the smallest batch whose orders/s is near the max while per-call ms stays acceptable.");
})();
'
