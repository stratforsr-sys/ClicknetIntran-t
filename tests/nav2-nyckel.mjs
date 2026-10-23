#!/usr/bin/env node
/**
 * Granskningen S03 (G1, G2, F2-3): en skrivning som skickas två gånger görs en gång.
 *
 * Klienten (`ndSkriv` i utkastet) skickar huvudet `X-Nav-Nyckel` och samma
 * nyckel igen när ett försök inte fick något svar. `medNyckel` tar emot den:
 * första gången körs handlingen och svaret sparas i `nav_skrivnyckel` (0208),
 * nästa gång får klienten samma svar tillbaka, och medan den första pågår
 * får den andra 409 i stället för ett inlägg till.
 *
 * Lagret byts här mot ett i minnet med samma regler som tabellen (primärnyckel
 * på nyckeln, rader äldre än ett dygn räknas inte). Själva tabellen provas i
 * torrkörningen av 0208.
 *
 *   node --experimental-strip-types tests/nav2-nyckel.mjs
 */
import { PAGAR_TEXT, medNyckel, nyckelBeslut } from "../src/lib/nav2/nyckel.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

rubrik("Beslutet");
ok("raden togs: kör", nyckelBeslut(true, null) === "kor");
ok("raden fanns och är klar: samma svar igen", nyckelBeslut(false, { klar: true, status: 200, svar: {} }) === "upprepa");
ok("raden fanns och pågår: vänta", nyckelBeslut(false, { klar: false, status: null, svar: null }) === "pagar");

// Ett lager i minnet med tabellens regler.
function minne() {
  const rader = new Map();
  return {
    rader,
    async ta(nyckel, aktor) {
      const r = rader.get(nyckel);
      if (r && Date.now() - r.skapad < 864e5) return { togs: false, rad: r };
      const ny = { aktor, skapad: Date.now(), klar: false, status: null, svar: null };
      rader.set(nyckel, ny);
      return { togs: true, rad: null };
    },
    async spara(nyckel, status, svar) {
      Object.assign(rader.get(nyckel), { klar: true, status, svar });
    },
    async slapp(nyckel) {
      rader.delete(nyckel);
    },
  };
}
const begaran = (nyckel) => new Request("https://nav.test/nav2/nyheter", { method: "POST", headers: nyckel ? { "x-nav-nyckel": nyckel } : {} });
const ZEN = "826a8b10-34c4-46ff-81d1-ca797773235c";

rubrik("Utan nyckel");
{
  const l = minne();
  let n = 0;
  const gor = async () => { n++; return Response.json({ ok: "Publicerat." }); };
  await medNyckel(begaran(null), ZEN, gor, l);
  await medNyckel(begaran(null), ZEN, gor, l);
  ok("körs varje gång, som i dag", n === 2, `${n} gånger`);
  ok("ingen rad sparas", l.rader.size === 0);
}

rubrik("Samma nyckel två gånger");
{
  const l = minne();
  let n = 0;
  const gor = async () => { n++; return Response.json({ ok: "Publicerat. 3 fick en notis.", slug: "prov" }, { status: 200 }); };
  const a = await medNyckel(begaran("k-1111-2222"), ZEN, gor, l);
  const b = await medNyckel(begaran("k-1111-2222"), ZEN, gor, l);
  ok("handlingen görs en gång", n === 1, `${n} gånger`);
  ok("första svaret som det var", a.status === 200 && (await a.json()).ok === "Publicerat. 3 fick en notis.");
  const bj = await b.json();
  ok("andra svaret är det första igen", b.status === 200 && bj.ok === "Publicerat. 3 fick en notis." && bj.slug === "prov");
  ok("och säger att det är en upprepning", b.headers.get("x-nav-upprepad") === "1");
}

rubrik("Medan den första pågår");
{
  const l = minne();
  let n = 0, slapp;
  const gor = () => { n++; return new Promise((r) => { slapp = () => r(Response.json({ ok: "Publicerat." })); }); };
  const forsta = medNyckel(begaran("k-3333-4444"), ZEN, gor, l);
  await new Promise((r) => setTimeout(r, 5));
  const andra = await medNyckel(begaran("k-3333-4444"), ZEN, gor, l);
  ok("den andra får 409", andra.status === 409, `status ${andra.status}`);
  const aj = await andra.json();
  ok("med pågår-texten, och märkt så att klienten behåller nyckeln", aj.fel === PAGAR_TEXT && aj.pagar === true);
  ok("pågår-texten är planens", PAGAR_TEXT === "Det här sparas redan. Vänta ett ögonblick.");
  slapp();
  await forsta;
  ok("handlingen gjordes en gång", n === 1);
}

rubrik("Fel och gränser");
{
  const l = minne();
  const gor = async () => Response.json({ fel: "Skriv en rubrik." }, { status: 400 });
  await medNyckel(begaran("k-5555-6666"), ZEN, gor, l);
  const b = await medNyckel(begaran("k-5555-6666"), ZEN, gor, l);
  ok("ett nej sparas också och kommer tillbaka lika", b.status === 400 && (await b.json()).fel === "Skriv en rubrik.");
}
{
  const l = minne();
  let n = 0;
  const gor = async () => { n++; throw new Error("nätet föll"); };
  let kastade = false;
  try { await medNyckel(begaran("k-7777-8888"), ZEN, gor, l); } catch { kastade = true; }
  ok("en handling som kastar släpper nyckeln", kastade && !l.rader.has("k-7777-8888"));
}
{
  const l = minne();
  await medNyckel(begaran("k-9999-0000"), ZEN, async () => Response.json({ ok: "Publicerat." }), l);
  const b = await medNyckel(begaran("k-9999-0000"), "5259d4cb-c774-4ef6-9459-a9509816558f", async () => Response.json({ ok: "x" }), l);
  ok("någon annans nyckel ger inte deras svar", b.status === 400 && !(await b.text()).includes("Publicerat"));
}
{
  const l = minne();
  let n = 0;
  await medNyckel(begaran("<script>"), ZEN, async () => { n++; return Response.json({ ok: "" }); }, l);
  ok("en nyckel som inte ser ut som en nyckel används inte", n === 1 && l.rader.size === 0);
}
{
  const l = minne();
  let n = 0;
  const gor = async () => { n++; return Response.json({ ok: "Publicerat." }); };
  await medNyckel(begaran("k-aaaa-bbbb"), ZEN, gor, l);
  l.rader.get("k-aaaa-bbbb").skapad -= 25 * 3600e3;
  await medNyckel(begaran("k-aaaa-bbbb"), ZEN, gor, l);
  ok("en nyckel äldre än ett dygn räknas som ny", n === 2, `${n} gånger`);
}

// Granskningen S06 (G1): "Lägg 2 000 kr till Fredrik" i Provision går genom medNyckel.
rubrik("Övrig bonus i Provision (S06, G1)");
{
  const l = minne();
  const poster = [];
  // Som laggOvrigBonus: en ren insert, och inget i databasen stoppar en dubblett.
  const gor = async () => { poster.push({ vem: "Fredrik", belopp: 2000 }); return Response.json({ ok: "Bonusen är bokförd." }); };
  const pv = (nyckel) => new Request("https://nav.test/nav2/provision", { method: "POST", headers: { "x-nav-nyckel": nyckel } });
  const a = await medNyckel(pv("k-bonus-0001"), ZEN, gor, l);
  // Klienten fick inget svar inom tidsgränsen och försöker igen med samma nyckel.
  const b = await medNyckel(pv("k-bonus-0001"), ZEN, gor, l);
  ok("samma nyckel två gånger: en post", poster.length === 1, `${poster.length} poster`);
  ok("det andra svaret är det första, märkt som upprepning", b.status === 200 && (await b.json()).ok === "Bonusen är bokförd." && b.headers.get("x-nav-upprepad") === "1" && a.status === 200);
  ok("beslutet för det andra försöket är upprepa", nyckelBeslut(false, l.rader.get("k-bonus-0001")) === "upprepa");
}
{
  // Rutten slår in handlingen bonus i medNyckel (annars når nyckeln aldrig fram).
  const { readFileSync } = await import("node:fs");
  const kalla = readFileSync(new URL("../src/app/nav2/provision/route.ts", import.meta.url), "utf8");
  const gren = kalla.slice(kalla.indexOf('case "bonus":'), kalla.indexOf('case "bonus-bort"'));
  ok("provisionsruttens bonus går genom medNyckel", /import \{[^}]*\bmedNyckel\b[^}]*\} from "@\/lib\/nav2\/nyckel"/.test(kalla) && /return medNyckel\(request, mig,/.test(gren));
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
