// Kirim agenda kalender ARW ke Discord (webhook) secara otomatis.
//  - Rekap agenda hari ini  : sekali per hari, mulai jam 12:00 WIB
//  - Pengingat per agenda   : 30 menit sebelum agenda mulai
// Dijalankan tiap 5 menit oleh GitHub Actions. Tanpa dependensi (Node 20+).
import fs from "node:fs";

const PROJECT = process.env.FIREBASE_PROJECT || "clan-arw";
const HOOK_REKAP = process.env.WEBHOOK_REKAP || "";
const HOOK_REMIND = process.env.WEBHOOK_REMINDER || HOOK_REKAP;
const MENTION = (process.env.MENTION || "").trim();      // contoh: @everyone  atau  <@&ID_ROLE>
const REMIND_MIN = +(process.env.REMIND_MIN || 30);       // berapa menit sebelum agenda
const REKAP_HOUR = +(process.env.REKAP_HOUR || 12);       // jam rekap (WIB)
const REKAP_UNTIL = +(process.env.REKAP_UNTIL || 15);     // lewat jam ini rekap dilewati
const DRY = process.env.DRY_RUN === "1";
const STATE_FILE = process.env.STATE_FILE || ".github/state/sent.json";
const NOW = process.env.NOW_OVERRIDE ? Date.parse(process.env.NOW_OVERRIDE) : Date.now();

const ICO = { clan:"🟣", war:"⚔️", event:"🎮", train:"🏋️", club:"🪩", gunung:"🏔️", konten:"🎬", basecamp:"🏀", horor:"👻" };
const LBL = { clan:"Clan Meeting", war:"Clan War", event:"Event Roblox", train:"Latihan", club:"Club", gunung:"Gunung", konten:"Konten", basecamp:"Kumpul Basecamp", horor:"Horor" };
const COL = { clan:"#e0c3ff", war:"#ff5d5d", event:"#4fd8ff", train:"#3dffa0", club:"#ffc93c", gunung:"#a3e635", konten:"#ff8ad8", basecamp:"#ff9f43", horor:"#9d8cff" };
const HARI = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
const BLN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

// sama persis dengan logika di web
const kind = e => /horor|horror|hantu/i.test(e.name) ? "horor"
  : (/base\s?camp|kumpul/i.test(e.name) && e.type !== "club" && e.type !== "gunung") ? "basecamp" : e.type;
const pad = n => String(n).padStart(2, "0");
const wibParts = ms => { const w = new Date(ms + 7 * 36e5); return { y: w.getUTCFullYear(), m: w.getUTCMonth(), d: w.getUTCDate(), h: w.getUTCHours(), dow: w.getUTCDay() } };
const dateKey = ms => { const p = wibParts(ms); return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}` };
const startMs = (k, t) => { const [y, m, d] = k.split("-").map(Number), [h, mi] = String(t).split(":").map(Number); return Date.UTC(y, m - 1, d, h - 7, mi) };
const colorInt = hex => parseInt((hex || "#ffffff").slice(1), 16);

// ── baca Firestore (REST) ──
const fsVal = v => {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return +v.integerValue;
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fsVal(x)]));
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsVal);
  return null;
};
async function loadDoc(name, mockEnv) {
  let json;
  if (process.env[mockEnv]) json = JSON.parse(fs.readFileSync(process.env[mockEnv], "utf8"));
  else {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/arw/${name}`);
    if (r.status === 404) return {};
    if (!r.ok) throw new Error("Firestore " + r.status + ": " + (await r.text()).slice(0, 200));
    json = await r.json();
  }
  return fsVal({ mapValue: { fields: json.fields || {} } }) || {};
}
const loadEvents = async () => (await loadDoc("kalender", "MOCK_FILE")).events || {};

// ── state: supaya tidak kirim dobel ──
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) } catch { }
const today = dateKey(NOW);
for (const k of Object.keys(state)) if (k.split("|")[1] < dateKey(NOW - 3 * 864e5)) delete state[k]; // buang yang >3 hari

// ── kirim ke Discord ──
async function post(url, body) {
  if (DRY) { console.log("[DRY] →", JSON.stringify(body, null, 2)); return true }
  if (!url) { console.error("Webhook belum diisi"); return false }
  for (let i = 0; i < 2; i++) {
    const r = await fetch(url + "?wait=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return true;
    if (r.status === 429) { const j = await r.json().catch(() => ({})); await new Promise(s => setTimeout(s, (j.retry_after || 2) * 1000 + 200)); continue }
    console.error("Discord", r.status, (await r.text()).slice(0, 200)); return false;
  }
  return false;
}
const allowed = MENTION ? { parse: ["everyone", "roles"] } : { parse: [] };

let fail = false;
const events = await loadEvents();

// bentuk pesan rekap untuk satu tanggal (dipakai rekap harian & tombol web)
const rekapBody = (k, list, judul, headline) => {
  const [y, m, d] = k.split("-").map(Number), dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return {
    content: MENTION ? `${MENTION} ${headline}` : headline,
    allowed_mentions: allowed,
    embeds: [{
      title: `${judul} — ${HARI[dow]}, ${d} ${BLN[m - 1]} ${y}`,
      description: list.map(e => { const t = kind(e); return `${ICO[t] || "📌"} **${e.time} WIB** — ${e.name}\n└ ${LBL[t] || "Agenda"}` }).join("\n\n"),
      color: 0xffd86b,
      footer: { text: `${list.length} agenda · Semua jam dalam WIB` }
    }]
  };
};
const agendaOf = k => (events[k] || []).filter(e => e && e.time).sort((a, b) => a.time.localeCompare(b.time));

// 1) REKAP HARI INI
const hr = wibParts(NOW).h;
const rk = `rekap|${today}`;
if (hr >= REKAP_HOUR && hr < REKAP_UNTIL && !state[rk]) {
  const list = agendaOf(today);
  if (list.length) {
    const ok = await post(HOOK_REKAP, rekapBody(today, list, "📅 Agenda ARW", "📅 Agenda ARW hari ini!"));
    if (ok) state[rk] = 1; else fail = true;
  } else state[rk] = 1; // tidak ada agenda → tidak usah dicek lagi hari ini
}

// 1b) PERMINTAAN DARI TOMBOL "KIRIM PENGUMUMAN" DI WEB
try {
  const req = await loadDoc("kirim", "MOCK_KIRIM");
  if (req.id && /^\d{4}-\d{2}-\d{2}$/.test(req.date || "") && !state["man|" + req.id]) {
    const list = agendaOf(req.date);
    if (list.length) {
      const ok = await post(HOOK_REKAP, rekapBody(req.date, list, "📣 Pengumuman Agenda ARW", "📣 Pengumuman agenda ARW!"));
      if (ok) state["man|" + req.id] = 1; else fail = true;
    } else state["man|" + req.id] = 1;
  }
} catch (e) { console.error("Cek permintaan manual gagal:", e.message) }

// 2) PENGINGAT X MENIT SEBELUM AGENDA
for (const k of [today, dateKey(NOW + 864e5)]) {
  for (const e of (events[k] || [])) {
    if (!e || !e.time) continue;
    const t = startMs(k, e.time), diff = t - NOW;
    if (diff <= 0 || diff > REMIND_MIN * 6e4) continue;
    const id = `rem|${k}|${e.time}|${e.name}`;
    if (state[id]) continue;
    const ty = kind(e), unix = Math.floor(t / 1000), min = Math.ceil(diff / 6e4);
    const ok = await post(HOOK_REMIND, {
      content: MENTION ? `${MENTION} ⏰ Pengingat agenda!` : "⏰ Pengingat agenda!",
      allowed_mentions: allowed,
      embeds: [{
        title: `${ICO[ty] || "📌"} ${e.name}`,
        description: `**${LBL[ty] || "Agenda"}** dimulai <t:${unix}:R>\n🕗 Jam **${e.time} WIB** (±${min} menit lagi)`,
        color: colorInt(COL[ty]),
        footer: { text: "ARW Reborn" }
      }]
    });
    if (ok) state[id] = 1; else fail = true;
  }
}

if (!DRY) fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + "\n");
if (fail) process.exit(1);
console.log("Selesai.", new Date(NOW).toISOString());
