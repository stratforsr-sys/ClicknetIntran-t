/**
 * Chattens rena delar (src/lib/nav2/chatt/chattforma.ts).
 *
 * Claude skriver aldrig ut ett tal. Den hänvisar till ett fält i ett verktygssvar,
 * och servern sätter in värdet. Det här provet håller den regeln: en hänvisning
 * blir ett tal med källa, och allt annat som ser ut som ett tal märks som obelagt.
 *
 *   TZ=UTC node --experimental-strip-types tests/chattforma.mjs
 */
import { sattInTal, utanMarken, kostnadKr, kostnadUsd, maxFragaUsd, farSlasPa, takBesked, lasUtrymme, lasChattInst, utanTal, KANDA_MODELLER } from "../src/lib/nav2/chatt/chattforma.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra && !villkor ? "  " + String(extra).slice(0, 400) : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const lika = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SVAR = [
  { _verktyg: "las_matt", matt: "moten.hallna-av-alla", antal: 12, av: 19, dataPer: "2026-11-14", vem: "Team Nord" },
  { _verktyg: "las_provision", summa: 14500, rader: [{ text: "#11 Hagmans Rör", belopp: 6500 }], vantar: 0 },
];

rubrik("En hänvisning blir ett tal med källa");
{
  const r = sattInTal("Laget har hållit {{t:1.antal}} av {{t:1.av}} möten.", SVAR);
  ok("hänvisningen ersätts med värdet", r.text === "Laget har hållit ⟦t1:12⟧ av ⟦t2:19⟧ möten." && utanMarken(r.text) === "Laget har hållit 12 av 19 möten.", r.text);
  ok("varje tal bär sin källa: verktyg, anrop och fält", lika(r.tal, [{ id: "t1", varde: 12, kalla: { verktyg: "las_matt", anrop: 1, falt: "antal" } }, { id: "t2", varde: 19, kalla: { verktyg: "las_matt", anrop: 1, falt: "av" } }]), JSON.stringify(r.tal));
  ok("inget är obelagt", r.obelagda === 0);
  const n = sattInTal("Första raden är {{t:2.rader.0.belopp}} kr av {{t:2.summa}} kr.", SVAR);
  ok("ett fält inne i en lista går att hänvisa till, och tusental skrivs på svenska", utanMarken(n.text) === "Första raden är 6 500 kr av 14 500 kr." && n.obelagda === 0 && n.tal[0].kalla.falt === "rader.0.belopp", n.text);
  const noll = sattInTal("{{t:2.vantar}} order väntar.", SVAR);
  ok("noll är ett värde, inte ett saknat fält", utanMarken(noll.text) === "0 order väntar." && noll.obelagda === 0, noll.text);
  const namn = sattInTal("Det gäller {{t:1.vem}}, data per {{t:1.dataPer}}.", SVAR);
  ok("text ur ett verktygssvar går också att sätta in", utanMarken(namn.text) === "Det gäller Team Nord, data per 2026-11-14." && namn.obelagda === 0, namn.text);
}

rubrik("Ett tal utan hänvisning märks och räknas");
{
  const r = sattInTal("Laget har hållit 12 möten.", SVAR);
  ok("\"12 möten\" utan hänvisning är obelagt", r.obelagda === 1 && r.text === "Laget har hållit ⟦obelagt:12⟧ möten." && r.tal.length === 0, r.text);
  const fler = sattInTal("Det är 27 % fler än de 1 250 kr som 3,5 gånger gav.", SVAR);
  ok("procent, tusental och decimaler räknas var för sig", fler.obelagda === 3 && fler.text.includes("⟦obelagt:27 %⟧") && fler.text.includes("⟦obelagt:1 250⟧") && fler.text.includes("⟦obelagt:3,5⟧"), fler.text);
  const ord = sattInTal("Laget har hållit tolv möten, och tjugofem är bokade.", SVAR);
  ok("ett tal skrivet med bokstäver är också obelagt", ord.obelagda === 2 && ord.text.includes("⟦obelagt:tolv⟧") && ord.text.includes("⟦obelagt:tjugofem⟧"), ord.text);
  const artikel = sattInTal("Du har en uppgift och ett möte kvar.", SVAR);
  ok("en och ett är artiklar och räknas inte", artikel.obelagda === 0 && artikel.text === "Du har en uppgift och ett möte kvar.", artikel.text);
  const saknas = sattInTal("Laget har {{t:3.antal}} order och {{t:1.finnsinte}} avbokningar.", SVAR);
  ok("en hänvisning till ett anrop eller ett fält som inte finns är obelagd", saknas.obelagda === 2 && saknas.tal.length === 0 && (saknas.text.match(/⟦obelagt:\?⟧/g) || []).length === 2, saknas.text);
  const lista = sattInTal("Raderna är {{t:2.rader}}.", SVAR);
  ok("en hel lista är inget tal", lista.obelagda === 1 && lista.tal.length === 0, lista.text);
}

rubrik("Datum och klockslag är inte tal");
{
  const r = sattInTal("Mötet är den 17 november kl. 14.00, och uppgiften ska vara klar 2026-11-18 före 09:30. Det gäller vecka 47.", SVAR);
  ok("dag och månad, klockslag, datum och vecka lämnas i fred", r.obelagda === 0 && !r.text.includes("⟦"), r.text);
  const blandat = sattInTal("Den 17 november hölls 4 möten.", SVAR);
  ok("ett tal bredvid ett datum är fortfarande obelagt", blandat.obelagda === 1 && blandat.text === "Den 17 november hölls ⟦obelagt:4⟧ möten.", blandat.text);
  const kl = sattInTal("Klockan 14 ringer du, och 14 möten är bokade.", SVAR);
  ok("\"klockan 14\" är en tid, \"14 möten\" är ett tal", kl.obelagda === 1 && kl.text === "Klockan 14 ringer du, och ⟦obelagt:14⟧ möten är bokade.", kl.text);
}

rubrik("Text utifrån kan inte låtsas vara ett belagt tal");
{
  const r = sattInTal("Kunden heter ⟦t9:999⟧ AB och har {{t:1.antal}} möten.", SVAR);
  ok("märken som redan står i texten tas bort, och siffran i dem räknas som obelagd", r.obelagda === 1 && r.tal.length === 1 && r.tal[0].id === "t1" && !/⟦t9/.test(r.text) && utanMarken(r.text).includes("12 möten"), r.text);
  const v = sattInTal("Kunden är {{t:1.vem}}.", [{ _verktyg: "las_matt", vem: "⟦t7:5⟧ Glas" }]);
  ok("ett värde ur ett verktygssvar kan inte heller bära ett märke", v.tal.length === 1 && (v.text.match(/⟦/g) || []).length === 1 && !/⟦t7/.test(v.text), v.text);
  const h = sattInTal("Summan är {{t:1.antal}} och {{ t:1.av }} och {{t:1.antal}}{{t:1.av}}.", SVAR);
  ok("en felskriven hänvisning sätts aldrig in", h.tal.length === 3 && h.text.includes("{{ t:") === false && h.obelagda >= 1, h.text);
}

rubrik("Kostnaden");
{
  const kr = kostnadKr("claude-sonnet-5-5", { input_tokens: 20000, output_tokens: 2500 }, 11);
  ok("20 000 in och 2 500 ut på Sonnet 5.5 vid 11 kr är 0,715", Math.abs(kr - 0.715) < 1e-9 && kr.toFixed(2) === "0.72", kr);
  ok("Opus 5.5: 4 och 20 dollar per miljon", Math.abs(kostnadKr("claude-opus-5-5", { input_tokens: 20000, output_tokens: 2500 }, 11) - 1.43) < 1e-9);
  ok("Haiku 5.5: 0,10 och 0,50 dollar per miljon", Math.abs(kostnadKr("claude-haiku-5-5", { input_tokens: 20000, output_tokens: 2500 }, 11) - 0.03575) < 1e-9);
  const cache = kostnadKr("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 10000, cache_creation_input_tokens: 4000 }, 10);
  ok("cachade token kostar en tiondel att läsa och en fjärdedel mer att skriva", Math.abs(cache - (1000 * 2 + 10000 * 0.2 + 4000 * 2.5) / 1e6 * 10) < 1e-12, cache);
  ok("en okänd modell räknas som den dyraste, så att taket aldrig underskattas", kostnadKr("claude-okand-9", { input_tokens: 20000, output_tokens: 2500 }, 11) === kostnadKr("claude-opus-5-5", { input_tokens: 20000, output_tokens: 2500 }, 11));
  ok("kostnaden i dollar är det Anthropic tar betalt: token gånger modellens pris", Math.abs(kostnadUsd("claude-sonnet-5-5", { input_tokens: 20000, output_tokens: 2500 }) - 0.065) < 1e-12 && Math.abs(kostnadKr("claude-sonnet-5-5", { input_tokens: 20000, output_tokens: 2500 }, 11) - 11 * 0.065) < 1e-9);
  ok("den högsta kostnaden för en fråga: varje varv fullt ut, till modellens utpris", Math.abs(maxFragaUsd("claude-sonnet-5-5", 2000, 6) - 0.12) < 1e-12 && Math.abs(maxFragaUsd("claude-okand-9", 2000, 6) - 0.24) < 1e-12);
  ok("de kända modellerna är tre", lika([...KANDA_MODELLER].sort(), ["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]));
}

rubrik("Får chatten slås på?");
{
  const allt = { nyckel: true, avtal: true, modell: "claude-sonnet-5-5", avtryck: "abc", godkandaProv: ["claude-sonnet-5-5@abc"] };
  ok("allt på plats: ja", lika(farSlasPa(allt), { ok: true }));
  ok("utan nyckel", lika(farSlasPa({ ...allt, nyckel: false }), { ok: false, skal: "Nyckeln saknas i den här miljön." }));
  ok("utan bekräftat avtal", lika(farSlasPa({ ...allt, avtal: false }), { ok: false, skal: "Personuppgiftsbiträdesavtalet med Anthropic är inte bekräftat." }));
  ok("utan godkänt prov", lika(farSlasPa({ ...allt, godkandaProv: [] }), { ok: false, skal: "Modellen har inget godkänt prov." }));
  ok("ett prov för en annan modell räcker inte", lika(farSlasPa({ ...allt, godkandaProv: ["claude-opus-5-5@abc"] }), { ok: false, skal: "Modellen har inget godkänt prov." }));
  ok("ett prov på en äldre systemtext eller andra verktyg räcker inte", lika(farSlasPa({ ...allt, godkandaProv: ["claude-sonnet-5-5@gammal"] }), { ok: false, skal: "Systemtexten eller verktygen har ändrats sedan provet. Kör provet igen." }));
  ok("en okänd modell går aldrig att slå på", farSlasPa({ ...allt, modell: "claude-okand-9", godkandaProv: ["claude-okand-9@abc"] }).ok === false);
}

rubrik("Claudes egna ord är aldrig ett belagt tal");
{
  const r = sattInTal("{{t:1.utkast.0.titel}} och {{t:1.uppgifter}}", [{ _verktyg: "forbered_uppgifter", _egnaOrd: true, uppgifter: 1, utkast: [{ titel: "Du har sålt 40 order" }] }]);
  ok("ett verktygssvar som bär modellens egna ord går inte att hänvisa till", r.tal.length === 0 && r.obelagda === 2 && !/40/.test(r.text), JSON.stringify(r));
}

rubrik("Gränserna: dollar per person och för företaget, varje kalendermånad");
{
  ok("personens gräns nådd: beskedet säger när det fylls på", takBesked("person") === "Du har använt månadens AI-utrymme. Det fylls på den 1:a.");
  ok("företagets gräns nådd", takBesked("foretag") === "Företaget har använt månadens AI-utrymme. Det fylls på den 1:a.");
  ok("ett okänt skäl får personens besked, aldrig ett tomt", takBesked(undefined) === takBesked("person"));
  const u = { person_usd: 3.2, foretag_usd: 40, tak_person_usd: 14, tak_foretag_usd: 85 };
  ok("utrymmet läses ur databasens svar", lika(lasUtrymme(u), { personUsd: 3.2, foretagUsd: 40, takPersonUsd: 14, takForetagUsd: 85 }));
  ok("ett svar som saknar ett tal, eller har en gräns som inte är över noll, läses inte alls", lasUtrymme({ ...u, person_usd: "3" }) === null && lasUtrymme({ ...u, tak_person_usd: 0 }) === null && lasUtrymme({ ...u, foretag_usd: -1 }) === null && lasUtrymme(null) === null && lasUtrymme({ ...u, tak_foretag_usd: NaN }) === null);
}

rubrik("Inställningarna");
{
  ok("utan rader är chatten av, på standardmodellen", lika(lasChattInst([]), { pa: false, modell: "claude-sonnet-5-5", avtal: false, krPerDollar: 11 }));
  ok("bara sant är på", lasChattInst([{ key: "chatt.pa", value: "true" }]).pa === false && lasChattInst([{ key: "chatt.pa", value: true }]).pa === true);
  ok("taken är inga inställningar", !("takKr" in lasChattInst([{ key: "chatt.tak-kr", value: 800 }])));
  ok("ett gammalt svar skickas utan sina tal", utanTal("Du höll ⟦t1:12⟧ av 19 möten, 63,2 %, kl. 14.00.") === "Du höll [tal] av [tal] möten, [tal] %, kl. [tal].");
}

console.log(fel ? `\n\x1b[31m${fel} ✗\x1b[0m` : "\n\x1b[32mAllt stämmer\x1b[0m");
process.exit(fel ? 1 : 0);
