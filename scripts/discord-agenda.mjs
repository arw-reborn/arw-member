// ARW Reborn — Bot Agenda Discord (GitHub Actions, dijalankan tiap 5 menit)
//
//  • Jam 12:00 WIB    : pengumuman tiap agenda hari itu (pesan sendiri / template)
//  • 30 menit sebelum : pengingat lengkap (pesan/template + lokasi + dresscode + link map)
//  • 10 menit sebelum : hanya link map
//  • Tombol web       : "Kirim ke Discord" di mode edit kalender
//
// Pesan: ditulis di form kalender. Kalau kosong → bot memakai salah satu dari 20 template
// (dipilih acak, atau template yang dipilih di form).
import fs from "node:fs";
import { TEMPLATES } from "./templates.mjs";

const PROJECT = process.env.FIREBASE_PROJECT || "clan-arw";
const HOOK_REKAP = process.env.WEBHOOK_REKAP || "";
const HOOK_REMIND = process.env.WEBHOOK_REMINDER || HOOK_REKAP;
const MENTION = (process.env.MENTION || "").trim();      // @everyone  atau  <@&ID_ROLE>
const BOT_NAME = (process.env.BOT_NAME || "").trim();
const BOT_AVATAR = (process.env.BOT_AVATAR || "").trim();
const REKAP_HOUR = +(process.env.REKAP_HOUR || 12);
const REKAP_UNTIL = +(process.env.REKAP_UNTIL || 15);
const MAX_SEND = 6;                                      // batas pesan per sekali kirim (anti spam)
const DRY = process.env.DRY_RUN === "1";
const SINK = process.env.TEST_SINK || "";                // khusus tes
const STATE_FILE = process.env.STATE_FILE || ".github/state/sent.json";
const NOW = process.env.NOW_OVERRIDE ? Date.parse(process.env.NOW_OVERRIDE) : Date.now();

const ICO = { clan:"🟣", war:"⚔️", event:"🎮", train:"🏋️", club:"🪩", gunung:"🏔️", konten:"🎬", basecamp:"🏀", horor:"👻" };
const LBL = { clan:"Clan Meeting", war:"Clan War", event:"Event Roblox", train:"Latihan", club:"Club", gunung:"Gunung", konten:"Konten", basecamp:"Kumpul Basecamp", horor:"Horor" };
const COL = { clan:"#e0c3ff", war:"#ff5d5d", event:"#4fd8ff", train:"#3dffa0", club:"#ffc93c", gunung:"#a3e635", konten:"#ff8ad8", basecamp:"#ff9f43", horor:"#9d8cff" };
const HARI = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
const BLN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const NOTICE = "⚠️ **Sistem ARW memantau kehadiran.** *Bolos Agenda* akan terdeteksi.\nHarap **hadir tepat waktu**, atau **izin** lebih dulu ke admin / lead / owner ARW jika berhalangan.";
const FOOT = "ARW Reborn • Sistem Agenda Otomatis";

// ── util ──
const kind = e => /horor|horror|hantu/i.test(e.name) ? "horor"
  : (/base\s?camp|kumpul/i.test(e.name) && e.type !== "club" && e.type !== "gunung") ? "basecamp" : e.type;
const pad = n => String(n).padStart(2, "0");
const wibParts = ms => { const w = new Date(ms + 7 * 36e5); return { y: w.getUTCFullYear(), m: w.getUTCMonth(), d: w.getUTCDate(), h: w.getUTCHours() } };
const dateKey = ms => { const p = wibParts(ms); return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}` };
const startMs = (k, t) => { const [y, m, d] = k.split("-").map(Number), [h, mi] = String(t).split(":").map(Number); return Date.UTC(y, m - 1, d, h - 7, mi) };
const colorInt = hex => parseInt((hex || "#ffffff").slice(1), 16);
const clip = (s, n) => { s = String(s || "").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s };
const dayTitle = k => { const [y, m, d] = k.split("-").map(Number); return `${HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${BLN[m - 1]} ${y}` };
const sleep = ms => (SINK || DRY) ? Promise.resolve() : new Promise(r => setTimeout(r, ms));

// field agenda
const wantMsg = e => e.msgOn !== false;                              // default ON
const customMsg = e => wantMsg(e) ? clip(e.msg, 1500) : "";           // teks buatan sendiri
const useLink = e => (e.linkOn !== false && /^https?:\/\/\S+$/i.test(String(e.link || "").trim())) ? String(e.link).trim() : "";
const dress = e => clip(e.dress, 60) || "ARW";
const lokasi = e => clip(e.loc, 80) || (useLink(e) ? "Lihat link map di bawah 👇" : "Akan diinformasikan");
const pickTpl = e => { const n = Math.trunc(+e.tpl); return (e.tplOn === true && n >= 1 && n <= TEMPLATES.length) ? n - 1 : Math.floor(Math.random() * TEMPLATES.length) };

// ── Firestore (REST, tanpa login) ──
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

// ── state ──
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) } catch { }
const today = dateKey(NOW), cutoff = dateKey(NOW - 3 * 864e5);
for (const k of Object.keys(state)) {
  const p = k.split("|");
  if (p.length > 1 && /^\d{4}-\d{2}-\d{2}$/.test(p[1]) && p[1] < cutoff) delete state[k];
}

// ── kirim ──
const allowed = MENTION ? { parse: ["everyone", "roles"] } : { parse: [] };
const wrap = (headline, embeds) => ({
  content: MENTION ? `${MENTION} ${headline}` : headline,
  allowed_mentions: allowed,
  ...(BOT_NAME ? { username: BOT_NAME } : {}), ...(BOT_AVATAR ? { avatar_url: BOT_AVATAR } : {}),
  embeds
});
async function post(url, body) {
  if (SINK) { fs.appendFileSync(SINK, JSON.stringify(body) + "\n"); return true }
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

// ── desain pesan ──
function renderTemplate(tp, k, e) {
  const hari = k === today ? "hari ini" : "pada " + dayTitle(k);
  const sub = s => { s = s.replaceAll("{hari}", hari).replaceAll("{Hari}", hari[0].toUpperCase() + hari.slice(1)); return tp.up ? s.toUpperCase() : s };
  const C = tp.caps, U = s => C ? s.toUpperCase() : s;
  const details = [
    `🎯 **${U("Agenda")}:** ${U(e.name)}`,
    `📅 **${U("Hari/Tanggal")}:** ${U(dayTitle(k))}`,
    `⏰ **${U("Waktu")}:** ${U(e.time + " WIB")}`,
    `📍 **${U("Lokasi")}:** ${U(lokasi(e))}`,
    `👕 **${U("Dresscode")}:** ${U(dress(e))}`
  ].join("\n");
  return { title: tp.head, description: [sub(tp.intro), details, sub(tp.outro), `**${tp.slogan}**`].filter(Boolean).join("\n\n") };
}
function announceEmbed(k, e, author) {
  const t = kind(e), unix = Math.floor(startMs(k, e.time) / 1000), link = useLink(e), custom = customMsg(e);
  let title, description, fields = [];
  let footer = FOOT;
  if (wantMsg(e) && !custom) {                                   // pakai template
    const i = pickTpl(e), r = renderTemplate(TEMPLATES[i], k, e);
    title = r.title; description = r.description; footer = `Template ${pad(i + 1)} • ${TEMPLATES[i].label} • ARW Reborn`;
    fields.push({ name: "⏳ Dimulai", value: `<t:${unix}:R>`, inline: true }, { name: "🏷️ Jenis", value: LBL[t] || "Agenda", inline: true });
  } else {                                                       // pesan sendiri / tanpa pesan
    title = `${ICO[t] || "📌"} ${e.name}`; description = custom ? ">>> " + custom : undefined;
    fields.push({ name: "🕗 Waktu", value: `**${e.time} WIB**\n<t:${unix}:R>`, inline: true }, { name: "📍 Lokasi", value: lokasi(e), inline: true }, { name: "👕 Dresscode", value: dress(e), inline: true });
  }
  if (link) fields.push({ name: "🗺️ Link Map", value: `[**🔗 Klik untuk masuk**](${link})` });
  fields.push({ name: "\u200b", value: NOTICE });
  return { author: { name: author }, title, description, color: colorInt(COL[t]), fields, footer: { text: footer } };
}
const announcePayload = (k, e, author, headline) => wrap(headline, [announceEmbed(k, e, author)]);

// ══════════ JALANKAN ══════════
let fail = false;
const events = (await loadDoc("kalender", "MOCK_FILE")).events || {};
const agendaOf = k => (events[k] || []).filter(e => e && e.time).sort((a, b) => a.time.localeCompare(b.time));

// 1) JAM 12 SIANG: pengumuman tiap agenda hari ini (yang masih > 30 menit lagi)
const hr = wibParts(NOW).h;
if (hr >= REKAP_HOUR && hr < REKAP_UNTIL) {
  let n = 0;
  for (const e of agendaOf(today)) {
    if (startMs(today, e.time) - NOW <= 30 * 6e4) continue;       // sisanya ditangani pengingat
    const id = `n12|${today}|${e.time}|${e.name}`;
    if (state[id] || n >= MAX_SEND) continue;
    if (await post(HOOK_REKAP, announcePayload(today, e, "ARW REBORN • PENGUMUMAN RESMI", "📢 **Pengumuman agenda ARW!**"))) { state[id] = 1; n++; await sleep(800) } else fail = true;
  }
}

// 2) TOMBOL "KIRIM KE DISCORD"
try {
  const req = await loadDoc("kirim", "MOCK_KIRIM");
  if (req.id && /^\d{4}-\d{2}-\d{2}$/.test(req.date || "") && state.lastManual !== req.id) {
    let n = 0;
    for (const e of agendaOf(req.date)) {
      if (req.date === today && startMs(today, e.time) <= NOW) continue;   // jangan umumkan yang sudah lewat
      if (n >= MAX_SEND) break;
      if (await post(HOOK_REKAP, announcePayload(req.date, e, "ARW REBORN • PENGUMUMAN AGENDA", "📣 **Pengumuman agenda ARW!**"))) { n++; await sleep(800) } else fail = true;
    }
    state.lastManual = req.id;
  }
} catch (e) { console.error("Cek permintaan manual gagal:", e.message) }

// 3) PENGINGAT: 30 menit (lengkap) & 10 menit (hanya link)
for (const k of [today, dateKey(NOW + 864e5)]) {
  for (const e of agendaOf(k)) {
    const diff = startMs(k, e.time) - NOW, min = Math.ceil(diff / 6e4);
    if (diff <= 0 || diff > 30 * 6e4) continue;
    const id = `${k}|${e.time}|${e.name}`, k30 = "r30|" + id, k10 = "r10|" + id;
    const full = () => post(HOOK_REMIND, announcePayload(k, e, `⏰ PENGINGAT • ${min} MENIT LAGI`, `⏰ **${e.name}** dimulai ${min} menit lagi!`));

    if (diff > 10 * 6e4) {
      if (!state[k30]) { if (await full()) state[k30] = 1; else fail = true }
    } else if (!state[k30] && !state[k10]) {                      // agenda baru/telat terdeteksi → kirim lengkap sekali
      if (await full()) { state[k30] = 1; state[k10] = 1 } else fail = true;
    } else if (!state[k10]) {
      const link = useLink(e);
      if (link) {
        const t = kind(e);
        const ok = await post(HOOK_REMIND, wrap(`🚀 **${e.name}** mulai ${min} menit lagi — link sudah siap!`, [{
          author: { name: "🚀 SEGERA DIMULAI" }, title: `${ICO[t] || "📌"} ${e.name}`,
          description: `### [🔗 Klik di sini untuk masuk](${link})`, color: colorInt(COL[t]), footer: { text: FOOT }
        }]));
        if (ok) state[k10] = 1; else fail = true;
      } else state[k10] = 1;
    }
  }
}

if (!DRY) fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + "\n");
if (fail) process.exit(1);
console.log("Selesai.", new Date(NOW).toISOString());
