#!/usr/bin/env node
/**
 * Granskningen S10 (F1-7, F1-10): mejlen till kandidaterna går en gång, och en
 * ombokning avbokar bara det som ligger framför.
 *
 *   TZ=UTC node --experimental-strip-types tests/rekrytering-utskick.mjs
 *
 * Ingen databas och inga mejl: `rekrytering-utskick.ts` körs mot en attrapp som
 * beter sig som Postgres för de frågor den gör (en villkorad uppdatering tar en
 * rad bara en gång), och Resend byts mot en som spelar in.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
const stubbar = {
  "@/lib/supabase/server": "export function supabaseAdmin() { return globalThis.__db; }",
  "@/lib/epost": `export function epostArKonfigurerad() { return true; }
export async function skickaEpost(b) { await new Promise((r) => setTimeout(r, 5)); globalThis.__brev.push(b); return { skickat: true, id: "re_" + globalThis.__brev.length }; }
export async function avbrytSchemalagt() { globalThis.__avbrutna.push(1); return { skickat: false, orsak: "401: nyckeln får bara skicka" }; }`,
};
registerHooks({
  resolve(spec, ctx, nasta) {
    if (spec === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    if (stubbar[spec]) return { url: "data:text/javascript," + encodeURIComponent(stubbar[spec]), shortCircuit: true };
    if (spec.startsWith("@/")) return { url: pathToFileURL(join(rot, "src", spec.slice(2) + ".ts")).href, shortCircuit: true };
    return nasta(spec, ctx);
  },
});

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ---------------------------------------------------------------------------
rubrik("En ombokning avbokar bara det som ligger framför (F1-10)");
{
  const forma = await import("../src/lib/nav2/rekryteringforma.ts");
  const attAvboka = forma.attAvboka ?? (() => null);
  const b = [
    { id: "i-morse", day: "2026-10-23", start_min: 9 * 60 },
    { id: "i-eftermiddag", day: "2026-10-23", start_min: 15 * 60 },
    { id: "i-morgon", day: "2026-10-24", start_min: 9 * 60 },
    { id: "nya", day: "2026-10-27", start_min: 10 * 60 },
  ];
  const ids = (attAvboka(b, "2026-10-23", 11 * 60, "nya") ?? []).map((x) => x.id);
  ok("finns", typeof forma.attAvboka === "function");
  ok("en intervju som hållits i morse avbokas inte", !ids.includes("i-morse"), ids.join(","));
  ok("eftermiddagens och morgondagens avbokas", ids.includes("i-eftermiddag") && ids.includes("i-morgon"), ids.join(","));
  ok("den nya bokningen avbokas aldrig", !ids.includes("nya"));
  ok("en som börjar just nu avbokas inte", (attAvboka([{ id: "nu", day: "2026-10-23", start_min: 11 * 60 }], "2026-10-23", 11 * 60) ?? [1]).length === 0);
}

// ---------------------------------------------------------------------------
// Attrappen: candidate_message, candidate, employee, candidate_booking.
function attrapp(meddelanden, bokningar = []) {
  const t = {
    candidate_message: meddelanden,
    candidate: [
      { id: "k1", first_name: "Kim", last_name: "Kandidat", email: "kim@resend.dev" },
      { id: "k2", first_name: "Riktig", last_name: "Person", email: "riktig@example.se" },
    ],
    employee: [{ id: "e1", first_name: "Zen", last_name: "Test", email: "zen@clicknet.se" }],
    candidate_booking: bokningar,
  };
  return {
    from(tabell) {
      const q = { op: "select", varden: null, filter: [], head: false };
      const passar = (r) => q.filter.every(([s, k, v]) => (s === "eq" ? r[k] === v : s === "in" ? v.includes(r[k]) : s === "lte" ? r[k] <= v : s === "gte" ? r[k] >= v : true));
      const kor = async () => {
        await new Promise((r) => setTimeout(r, 1));
        if (globalThis.__felTabell === tabell && q.op === "select") return { data: null, error: { message: "tillfälligt fel" } };
        const rader = t[tabell].filter(passar);
        if (q.op === "update") {
          for (const r of rader) Object.assign(r, q.varden);
          return { data: rader.map((r) => ({ ...r })), error: null };
        }
        if (q.head) return { count: rader.length, data: null, error: null };
        return { data: rader.map((r) => ({ ...r })), error: null };
      };
      const k = {
        select: (_, o) => { if (o?.head) q.head = true; return k; },
        update: (v) => { q.op = "update"; q.varden = v; return k; },
        eq: (a, b) => { q.filter.push(["eq", a, b]); return k; },
        in: (a, b) => { q.filter.push(["in", a, b]); return k; },
        lte: (a, b) => { q.filter.push(["lte", a, b]); return k; },
        gte: (a, b) => { q.filter.push(["gte", a, b]); return k; },
        order: () => k, limit: () => k,
        then: (res, rej) => kor().then(res, rej),
      };
      return k;
    },
  };
}

const { skickaKandidatmejl, tomKandidatko } = await import("../src/lib/nav2/rekrytering-utskick.ts");
const rad = (id, over = {}) => ({ id, candidate_id: "k1", booking_id: null, template: "bekr", channel: "mejl", body: "Hej!", status: "vantar", send_after: new Date(Date.now() - 1000).toISOString(), resend_id: null, created_by: "e1", error: null, sent_at: null, ...over });

rubrik("Mejlet går en gång även när rutten och minutjobbet tar samma rad (F1-7)");
{
  process.env.VERCEL_ENV = "production";
  const m = [rad(1), rad(2)];
  globalThis.__db = attrapp(m);
  globalThis.__brev = [];
  const [a, b] = await Promise.all([skickaKandidatmejl([1, 2]), tomKandidatko()]);
  ok("två brev för två rader, inte fyra", globalThis.__brev.length === 2, `brev ${globalThis.__brev.length}`);
  ok("båda raderna är skickade", m.every((r) => r.status === "skickad"), m.map((r) => r.status).join(","));
  ok("utfallen räknar dem en gång", a.skickade + b.skickade === 2, `${a.skickade}+${b.skickade}`);
}

rubrik("Inget schemaläggs hos Resend: en påminnelse väntar i databasen (S14)");
{
  globalThis.__avbrutna = [];
  const om2h = new Date(Date.now() + 2 * 3600e3).toISOString();
  const m = [rad(3, { template: "sms24", send_after: om2h })];
  globalThis.__db = attrapp(m);
  globalThis.__brev = [];
  const u = await skickaKandidatmejl([3]);
  ok("inget brev före tiden", globalThis.__brev.length === 0);
  ok("raden väntar fortfarande", m[0].status === "vantar", m[0].status);
  ok("och räknas som kvar", u.kvar === 1, String(u.kvar));
  m[0].send_after = new Date(Date.now() - 1000).toISOString();
  await tomKandidatko();
  ok("minutjobbet skickar när det är dags", globalThis.__brev.length === 1 && m[0].status === "skickad", m[0].status);
  ok("brevet är inte schemalagt hos Resend", !globalThis.__brev[0].schemalagtVid);
}

rubrik("En avbokning stoppar påminnelsen i databasen, utan Resend");
{
  const { avbrytKandidatmejl } = await import("../src/lib/nav2/rekrytering-utskick.ts");
  globalThis.__avbrutna = [];
  const m = [rad(6, { template: "sms24", booking_id: "b1", send_after: new Date(Date.now() + 864e5).toISOString() }), rad(7, { booking_id: "b1", status: "skickar" })];
  globalThis.__db = attrapp(m);
  globalThis.__brev = [];
  const n = await avbrytKandidatmejl({ bokning: "b1" });
  ok("påminnelsen är avbruten", m[0].status === "avbruten" && n === 1, `${m[0].status} ${n}`);
  ok("Resend anropas inte", globalThis.__avbrutna.length === 0);
  ok("en rad som skickas just nu rörs inte", m[1].status === "skickar");
  await tomKandidatko();
  ok("och minutjobbet skickar den aldrig", globalThis.__brev.length === 0);
}

rubrik("Ett tillfälligt fel lämnar tillbaka raderna");
{
  process.env.VERCEL_ENV = "production";
  const m = [rad(8)];
  globalThis.__db = attrapp(m);
  globalThis.__brev = [];
  globalThis.__felTabell = "candidate";
  await skickaKandidatmejl([8]);
  globalThis.__felTabell = null;
  ok("raden väntar igen, inte fel", m[0].status === "vantar", `${m[0].status} ${m[0].error}`);
  await skickaKandidatmejl([8]);
  ok("och går ut nästa gång", m[0].status === "skickad" && globalThis.__brev.length === 1, m[0].status);
}

rubrik("Förhandsvisningen mejlar aldrig en riktig kandidat");
{
  process.env.VERCEL_ENV = "preview";
  const m = [rad(4, { candidate_id: "k2" }), rad(5)];
  globalThis.__db = attrapp(m);
  globalThis.__brev = [];
  await skickaKandidatmejl([4, 5]);
  ok("den riktiga adressen får inget brev", !globalThis.__brev.some((b) => b.till === "riktig@example.se"));
  ok("raden blir fel med orsaken", m[0].status === "fel" && /Förhandsvisningen/.test(m[0].error ?? ""), `${m[0].status} ${m[0].error}`);
  ok("en adress på resend.dev går ut för provets skull", globalThis.__brev.some((b) => b.till === "kim@resend.dev"));
}

rubrik("Avslag på en bokad intervju avbokar den med en CANCEL (rester efter våg 2)");
{
  process.env.VERCEL_ENV = "production";
  const bok = { id: "b9", kind: "int1", day: "2026-11-24", start_min: 9 * 60, end_min: 9 * 60 + 45, place: "Kontoret" };
  // Bekräftelsen (REQUEST) och avbokningen (CANCEL) går via samma utskick och samma bokning.
  const m = [rad(20, { template: "bokad", channel: "mejl_ics", booking_id: "b9" }), rad(21, { template: "avbokad", channel: "mejl_ics", booking_id: "b9", body: "Hej! Intervju 1 2026-11-24 kl. 09:00 är avbokad. Vi återkommer separat." })];
  globalThis.__db = attrapp(m, [bok]);
  globalThis.__brev = [];
  await skickaKandidatmejl([20, 21]);
  const ics = globalThis.__brev.map((b) => b.bilagor?.[0]?.innehall ?? "");
  const uid = (t) => /UID:([^\r\n]+)/.exec(t)?.[1];
  const sekv = (t) => /SEQUENCE:(\d+)/.exec(t)?.[1];
  ok("båda breven bär en kalenderfil", ics.every((t) => t.includes("BEGIN:VCALENDAR")), String(ics.length));
  ok("inbjudan är REQUEST och avbokningen CANCEL", /METHOD:REQUEST/.test(ics[0]) && /METHOD:CANCEL/.test(ics[1]), ics.map((t) => /METHOD:(\w+)/.exec(t)?.[1]).join(","));
  ok("samma UID, så att kandidatens kalender tar bort rätt post", !!uid(ics[0]) && uid(ics[0]) === uid(ics[1]), `${uid(ics[0])} / ${uid(ics[1])}`);
  ok("sekvensen är högre i avbokningen", Number(sekv(ics[1])) === Number(sekv(ics[0])) + 1, `${sekv(ics[0])} -> ${sekv(ics[1])}`);
  ok("avbokningen är markerad CANCELLED", /STATUS:CANCELLED/.test(ics[1]));
}

rubrik("Steget flyttas efter bokningen och avslaget skickar en CANCEL (rutten)");
{
  const { stegvagTill } = await import("../src/lib/rekrytering.ts");
  ok("ny kandidat till intervju 1: screening, sedan intervju 1", JSON.stringify(stegvagTill("new", "interview_1")) === '["screening","interview_1"]', JSON.stringify(stegvagTill("new", "interview_1")));
  ok("redan på intervju 1: inget steg", JSON.stringify(stegvagTill("interview_1", "interview_1")) === "[]");
  ok("på erbjudande: inget att flytta", JSON.stringify(stegvagTill("offer", "interview_1")) === "[]");
  ok("avslutad kandidat: inget att flytta", JSON.stringify(stegvagTill("rejected", "screening")) === "[]");

  const kalla = readFileSync(join(rot, "src/app/nav2/rekrytering/route.ts"), "utf8");
  const fall = (namn, nasta) => kalla.slice(kalla.indexOf(`case "${namn}": {`), kalla.indexOf(`case "${nasta}": {`));
  const boka = fall("boka", "avboka");
  const forst = (t, a, b) => t.indexOf(a) >= 0 && t.indexOf(b) >= 0 && t.indexOf(a) < t.indexOf(b);
  ok("boka: bokningen skrivs före steget flyttas", forst(boka, 'from("candidate_booking").insert', "await stegTill("), "");
  ok("boka: ingen flytt av steget före bokningen", boka.indexOf("await stegTill(") > boka.indexOf('from("candidate_booking").insert'));
  ok("boka: vägen kontrolleras ändå före bokningen", forst(boka, "stegvagTill(k.stage", "skapaMote("));
  const avslag = fall("avslag", "erbjudande");
  ok("avslag: steget flyttas först, sedan avbokas bokningarna", forst(avslag, 'flytta(k, "rejected"', "avbokaKommande("));
  ok("avslag: avbokningen får ett mejl (CANCEL) till kandidaten", /avbokaKommande\(k\.id, \{ foljd:/.test(avslag));
}

rubrik("Lägestexten för en rad som skickas");
{
  const forma = await import("../src/lib/nav2/rekryteringforma.ts");
  ok("RX-texten känner skickar", typeof forma.meddelandetext === "function" && /skickas/.test(forma.meddelandetext({ status: "skickar", template: "bekr", send_after: "2026-10-23T10:00:00Z" }, "Bekräftelsen")), typeof forma.meddelandetext);
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
