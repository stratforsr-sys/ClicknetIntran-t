// Kunskapsbasen: delningen i stycken och det som prövas innan ett dokument sparas (0312).
// Körs med: TZ=UTC node --experimental-strip-types tests/kunskap.mjs
import { readFileSync } from "node:fs";
import { STYCKE_MAX, TEXT_MAX, delaIStycken, farSkotaKunskap, filsort, grupperaMissar, provaDokument, titelUrFil } from "../src/lib/nav2/kunskapforma.ts";
import { DOKUMENT_TECKEN } from "../src/lib/nav2/chatt/verktyg.ts";

let fel = 0;
const ok = (namn, villkor, mer = "") => { if (villkor) console.log(`  \x1b[32m✓\x1b[0m ${namn}`); else { fel++; console.log(`  \x1b[31m✗\x1b[0m ${namn} ${mer}`); } };

console.log("Delningen i stycken");
{
  ok("ett stycke ryms i det chatten läser ur ett dokument", STYCKE_MAX <= DOKUMENT_TECKEN, `${STYCKE_MAX} > ${DOKUMENT_TECKEN}`);
  const kort = "# Sökord: transport\n\n## Flytt\n- flyttfirma\n- flytthjälp\n\n## Åkeri\n- åkeri\n- godstransport";
  const s = delaIStycken(kort);
  ok("ett kort dokument blir ett stycke", s.length === 1, JSON.stringify(s));
  ok("rubrikerna står kvar i texten och i rubrikfältet", s[0].text.includes("## Flytt") && s[0].text.includes("## Åkeri") && s[0].rubrik === "Flytt, Åkeri", s[0].rubrik);
  ok("en rubrik utan text under ger inget eget stycke", !s[0].text.includes("Sökord: transport"));
  ok("tom text ger inga stycken", delaIStycken("").length === 0 && delaIStycken("  \n\n ").length === 0 && delaIStycken("# Bara en rubrik").length === 0);

  const stycke = (n, ord) => Array.from({ length: n }, (_, i) => `${ord} mening nummer ${i} som säger något.`).join(" ");
  const langt = `Inledning utan rubrik.\n\n## Första\n${stycke(40, "Alfa")}\n\n${stycke(40, "Beta")}\n\n## Andra\n${stycke(30, "Gamma")}`;
  const l = delaIStycken(langt);
  ok("ett långt dokument blir flera stycken", l.length > 1, String(l.length));
  ok("inget stycke är längre än gränsen", l.every((x) => x.text.length <= STYCKE_MAX), l.map((x) => x.text.length).join(","));
  ok("inget stycke är tomt", l.every((x) => x.text.trim().length > 0));
  ok("texten före första rubriken kommer med", l[0].text.startsWith("Inledning utan rubrik."));
  ok("ett stycke som börjar mitt i ett avsnitt bär avsnittets rubrik", l.filter((x) => x.text.includes("Beta mening")).every((x) => x.text.includes("## Första")));
  const allt = l.map((x) => x.text).join(" ");
  ok("ingen mening försvinner", ["Alfa", "Beta", "Gamma"].every((o) => [0, 15, 29].every((i) => allt.includes(`${o} mening nummer ${i} som säger något.`))));
  ok("en mening som ryms delas aldrig", l.every((x) => !/mening nummer \d+ som säger$/.test(x.text.trim()) && x.text.trim().endsWith(".")));

  const utanSkiljetecken = "ord ".repeat(2000).trim();
  const u = delaIStycken(utanSkiljetecken);
  ok("en text utan styckebrytningar och punkter delas ändå", u.length > 1 && u.every((x) => x.text.length <= STYCKE_MAX));
  const lista = Array.from({ length: 400 }, (_, i) => `- sökord ${i}`).join("\n");
  const li = delaIStycken(`## Lista\n${lista}`);
  ok("en lång lista delas vid radbrytningar", li.length > 1 && li.every((x) => x.text.length <= STYCKE_MAX && x.text.split("\n").every((r) => /^(## Lista|- sökord \d+)$/.test(r))), JSON.stringify(li[0].text.slice(-40)));
  ok("Windows-radbrytningar läses som vanliga", delaIStycken("## A\r\nrad ett\r\nrad två")[0].text === "## A\nrad ett\nrad två");
  ok("en liten gräns går att sätta (provets egen)", delaIStycken("## A\naaa bbb.\n\n## B\nccc ddd.", 16).length === 2);
}

console.log("\nDet som prövas innan ett dokument sparas");
{
  const p = provaDokument({ titel: "  Sökord:   transport ", omrade: " Sälj ", text: "\r\nRad ett\r\nRad två\n" });
  ok("titel och område trimmas, texten behåller sina rader", p.ok && p.falt.titel === "Sökord: transport" && p.falt.omrade === "Sälj" && p.falt.text === "Rad ett\nRad två");
  ok("utan titel: nej", provaDokument({ titel: " ", text: "x" }).ok === false);
  ok("utan text: nej", provaDokument({ titel: "T", text: "  \n " }).ok === false);
  ok("för lång titel: nej", provaDokument({ titel: "a".repeat(161), text: "x" }).ok === false);
  ok("för långt område: nej", provaDokument({ titel: "T", omrade: "a".repeat(81), text: "x" }).ok === false);
  ok("för lång text: nej", provaDokument({ titel: "T", text: "a".repeat(TEXT_MAX + 1) }).ok === false);
  ok("så lång text som får plats: ja", provaDokument({ titel: "T", text: "a".repeat(TEXT_MAX) }).ok === true);
  ok("nolltecken tas bort (databasen tar inte emot dem)", provaDokument({ titel: "T", text: "a\u0000b" }).falt?.text === "ab");
  ok("annat än text blir text eller nej", provaDokument({ titel: 12, text: 34 }).ok === true && provaDokument({ titel: null, text: null }).ok === false);
}

console.log("\nFiler");
{
  ok("pdf, txt och md läses", filsort("Manus.PDF") === ".pdf" && filsort("a.txt") === ".txt" && filsort("b.md") === ".md");
  ok("annat läses inte", filsort("a.docx") === null && filsort("a") === null && filsort("") === null && filsort(null) === null && filsort("a.pdf.exe") === null);
  ok("titeln är filens namn utan ändelse", titelUrFil("sokord-transport_2026.md") === "sokord transport 2026" && titelUrFil(".pdf") === "Dokument");
}

console.log("\nListan över det som saknas");
{
  const g = grupperaMissar([{ sokord: "sökord vvs", nar: "2026-11-10T08:00:00Z" }, { sokord: "Sökord VVS", nar: "2026-11-12T08:00:00Z" }, { sokord: "pris hemsida", nar: "2026-11-13T08:00:00Z" }]);
  ok("samma sökning räknas ihop, oavsett stor och liten bokstav", g.length === 2 && g[0].antal === 2 && g[0].senast === "2026-11-12T08:00:00Z", JSON.stringify(g));
  ok("den mest frågade står först", g[0].sokord.toLowerCase() === "sökord vvs" && g[1].sokord === "pris hemsida");
}

console.log("\nVem som sköter kunskapsbasen");
{
  ok("admin och superadmin", farSkotaKunskap("admin") && farSkotaKunskap("superadmin"));
  ok("inte en säljare, och inte en okänd nivå", !farSkotaKunskap("salesperson") && !farSkotaKunskap("") && !farSkotaKunskap("chef"));
}

console.log("\nRutten och migrationen");
{
  const rutt = readFileSync(new URL("../src/app/nav2/kunskap/route.ts", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../supabase/migrations/0312_kunskapsbas.sql", import.meta.url), "utf8");
  ok("rutten prövar vem som sköter kunskapsbasen före varje läsning och skrivning", /farSkotaKunskap\(nivaFor\(user\.roles\)\)/.test(rutt) && (rutt.match(/await behorig\(\)/g) ?? []).length === 2 && rutt.indexOf("await behorig()") < rutt.indexOf("supabaseAdmin()"));
  ok("rutten prövar ursprunget och skrivläget före en skrivning", /sammaUrsprung\(request\)/.test(rutt) && /SKRIVLAGE\.kunskap/.test(rutt));
  ok("varje skrivning bokförs i händelseloggen", ["kunskap.added", "kunskap.changed", "kunskap.removed"].every((a) => rutt.includes(a)));
  ok("ingen skrivpolicy: bara servern skriver", !/for (insert|update|delete|all) to authenticated/i.test(sql));
  ok("listan över det som saknas går inte att läsa för inloggade", /grant select on public\.kunskap_dokument, public\.kunskap_stycke to authenticated/.test(sql));
  ok("sökningen körs som den som frågar", /kunskap_sok[\s\S]*?security invoker/.test(sql));
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAllt stämmer\x1b[0m");
process.exit(fel ? 1 : 0);
