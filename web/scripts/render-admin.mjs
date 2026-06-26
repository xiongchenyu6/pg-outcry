// Render the back-office console to PNG from real data (no browser).
//   ANON=<anon> SERVICE=<service_role> node scripts/render-admin.mjs
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const API = process.env.API ?? "http://127.0.0.1:54321";
const sb = createClient(API, process.env.SERVICE, { auth: { persistSession: false } });
const fmt = (n, d = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

const [{ data: rec }, { data: pend }, { data: ents }, { data: aud }] = await Promise.all([
  sb.rpc("reconcile"),
  sb.from("wallet_request").select("direction,currency,amount,status,created_at,app_entity(external_id)").eq("status", "PENDING").order("created_at"),
  sb.from("app_entity").select("external_id,type,status").order("created_at", { ascending: false }).limit(8),
  sb.from("admin_audit_log").select("action,target,created_at").order("created_at", { ascending: false }).limit(8),
]);
const fails = (rec || []).filter((r) => r.status !== "PASS").length;
const susp = (ents || []).filter((e) => e.status === "SUSPENDED").length;

const C = { bg: "#06080a", panel: "#0a0e10", line: "rgba(120,150,138,.16)", grid: "rgba(255,180,84,.05)",
  amber: "#ffb454", phos: "#4ef7a8", coral: "#ff5d6c", ink: "#cfe0d7", dim: "#6f8279", faint: "#3f4f48" };
const T = (x, y, s, fill, size = 12, anchor = "start", weight = 400) => `<text x="${x}" y="${y}" fill="${fill}" font-family="monospace" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${esc(s)}</text>`;
const Wd = 1280, H = 720;
let g = `<rect width="${Wd}" height="${H}" fill="${C.bg}"/>`;
for (let x = 0; x < Wd; x += 44) g += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${C.grid}"/>`;
g += `<rect x="0" y="0" width="${Wd}" height="44" fill="#0a0f11"/><line x1="0" y1="44" x2="${Wd}" y2="44" stroke="${C.line}"/>`;
g += T(16, 29, "OUTCRY", C.amber, 17, "start", 700) + T(110, 29, "/ADMIN", C.amber, 17, "start", 700);
g += T(Wd - 16, 28, fails ? `recon ${fails} FAIL` : "recon ALL PASS", fails ? C.coral : C.phos, 13, "end", 600);

// stats
const stats = [["entities", ents?.length ?? "—", C.ink], ["suspended", susp, susp ? C.amber : C.phos], ["pending wallet", pend?.length ?? 0, (pend?.length ? C.amber : C.phos)], ["recon fails", fails, fails ? C.coral : C.phos], ["audit", aud?.length ?? 0, C.ink]];
stats.forEach(([l, n, col], i) => { const x = 16 + i * 252; g += `<rect x="${x}" y="56" width="244" height="64" fill="${C.panel}"/>` + T(x + 14, 96, String(n), col, 26, "start", 600) + T(x + 14, 112, l, C.dim, 10, "start", 600); });

// panel helper
const panel = (x, y, w, h, title) => { g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.panel}"/>` + T(x + 12, y + 19, title, C.dim, 11, "start", 600) + `<line x1="${x}" y1="${y + 28}" x2="${x + w}" y2="${y + 28}" stroke="${C.line}"/>`; };

// approvals
panel(16, 136, 760, 270, "WALLET APPROVALS · pending");
let ry = 168; g += T(28, ry, "WHEN", C.faint, 10) + T(150, ry, "ENTITY", C.faint, 10) + T(360, ry, "DIR", C.faint, 10) + T(470, ry, "CUR", C.faint, 10) + T(560, ry, "AMOUNT", C.faint, 10) + T(700, ry, "ACTION", C.faint, 10); ry += 8;
(pend || []).slice(0, 8).forEach((r) => { ry += 24; g += `<line x1="16" y1="${ry - 16}" x2="776" y2="${ry - 16}" stroke="rgba(120,150,138,.06)"/>`;
  g += T(28, ry, new Date(r.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }), C.dim, 12)
    + T(150, ry, (r.app_entity?.external_id || "—").slice(0, 16), C.ink, 12)
    + T(360, ry, r.direction, r.direction === "DEPOSIT" ? C.phos : C.coral, 12)
    + T(470, ry, r.currency, C.ink, 12) + T(560, ry, fmt(r.amount), C.ink, 12)
    + `<rect x="700" y="${ry - 12}" width="32" height="15" fill="none" stroke="${C.phos}"/>` + T(704, ry, "OK", C.phos, 9)
    + `<rect x="738" y="${ry - 12}" width="32" height="15" fill="none" stroke="${C.coral}"/>` + T(742, ry, "NO", C.coral, 9); });
if (!pend?.length) g += T(28, 200, "No pending requests", C.faint, 12);

// reconciliation
panel(792, 136, 472, 270, "RECONCILIATION · invariants");
let yy = 172;
(rec || []).forEach((r) => { g += T(804, yy, r.check_name.replace(/_/g, " "), C.ink, 12) + T(1252, yy, r.status + (r.failures ? " · " + r.failures : ""), r.status === "PASS" ? C.phos : C.coral, 11, "end", 600); yy += 30; });

// accounts
panel(16, 422, 760, 282, "ACCOUNTS");
let ay = 458; g += T(28, ay, "EXTERNAL ID", C.faint, 10) + T(420, ay, "TYPE", C.faint, 10) + T(560, ay, "STATUS", C.faint, 10);
(ents || []).forEach((e) => { ay += 26; g += T(28, ay, (e.external_id || "—").slice(0, 30), C.ink, 12) + T(420, ay, e.type, C.dim, 12) + T(560, ay, e.status, e.status === "ACTIVE" ? C.phos : C.coral, 12); });

// audit
panel(792, 422, 472, 282, "ADMIN AUDIT LOG");
let uy = 458;
(aud || []).forEach((a) => { uy += 26; g += T(804, uy, new Date(a.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }), C.dim, 11) + T(880, uy, a.action, C.amber, 12) + T(1080, uy, (a.target || "").slice(0, 14), C.dim, 11); });
if (!aud?.length) g += T(804, 484, "No admin actions yet", C.faint, 12);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${H}" viewBox="0 0 ${Wd} ${H}">${g}</svg>`;
writeFileSync("docs/admin.png", new Resvg(svg, { fitTo: { mode: "width", value: 1280 }, font: { loadSystemFonts: true, defaultFontFamily: "monospace" } }).render().asPng());
console.log("wrote web/docs/admin.png — recon fails:", fails, "pending:", pend?.length, "entities:", ents?.length);
