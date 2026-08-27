#!/usr/bin/env node
/**
 * E6.1 / AC-12.1: att handelseloggen verkligen tacker samtliga sju typer.
 *
 *   node --experimental-strip-types tests/handelselogg.mjs
 *
 * Provet ar en jamforelse mot VERKLIGHETEN, i tva riktningar, av samma skal som
 * `tests/registerutdrag.mjs` jamfor mot framande nycklar:
 *
 *   1. KODEN. Varje action-strang som skrivs till `audit_log` nagonstans i
 *      src/ maste komma ur en REGISTRERAD modul. En ny modul som borjar logga
 *      faller har, medan det annu ar nagons huvud det ligger i.
 *   2. DATABASEN. Varje action som FINNS i produktionens logg maste gora det
 *      med. Det fangar det koden inte kan: rader skrivna av en tidigare
 *      version, eller med SQL for hand.
 *
 * Att typreglerna ar TOTALA (allt okant blir "andring") ar med flit — en ny
 * handelse i en kand modul ska hamna nagonstans rimligt i stallet for att falla
 * ur loggvyn. Det ar darfor kontrollen ligger pa MODULREGISTRET och inte pa
 * typen: annars hade provet varit gront medan sidan tappade rader.
 *
 * Kravs DATABASE_URL for del 2.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import {
  arModulKand,
  MODUL,
  modulNamn,
  TYPER,
  TYP_ETIKETT,
  typFor,
} from "../src/lib/handelselogg.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

console.log("\n\x1b[1mTyperna är sju\x1b[0m");
{
  // Antalet star i AC-12.1. Blir de atta har nagon andrat vad kravet betyder,
  // och det ar ett beslut som hor hemma i DECISIONS.md.
  ok("exakt sju typer", TYPER.length === 7, String(TYPER.length));
  ok("inga dubbletter", new Set(TYPER).size === 7);
  ok("varje typ har rubrik och beskrivning", TYPER.every((t) => TYP_ETIKETT[t]?.rubrik && TYP_ETIKETT[t]?.beskrivning));
  ok("rubrikerna är unika", new Set(TYPER.map((t) => TYP_ETIKETT[t].rubrik)).size === 7);
}

console.log("\n\x1b[1mOgiltig indata ger null\x1b[0m");
{
  ok("tom action", typFor("") === null);
  ok("null", typFor(null) === null);
  ok("undefined", typFor(undefined) === null);
  ok("utan punkt", typFor("nagot") === null, String(typFor("nagot")));
  ok("tomt prefix", typFor(".created") === null, String(typFor(".created")));
  ok("tom ändelse", typFor("employee.") === null, String(typFor("employee.")));
}

console.log("\n\x1b[1mOrdningen mellan reglerna\x1b[0m");
{
  ok("auth.login är autentisering", typFor("auth.login") === "autentisering");
  ok("auth.logout är autentisering", typFor("auth.logout") === "autentisering");
  ok("auth.login_failed är autentisering", typFor("auth.login_failed") === "autentisering");
  // Ett losenordsbyte ar en andring i teknisk mening och en
  // autentiseringshandelse i varje annan. Prefixet vinner.
  ok("auth.password_changed är autentisering, inte ändring", typFor("auth.password_changed") === "autentisering");

  ok("job.night_ok är system", typFor("job.night_ok") === "system");
  ok("error.new är system", typFor("error.new") === "system");

  ok("role.granted är behörighet", typFor("role.granted") === "behorighet");
  ok("permission.revoked är behörighet", typFor("permission.revoked") === "behorighet");

  // DEN VIKTIGA: indelningen gar pa PREFIXET, inte pa andelsen "revoked". En
  // tillbakadragen franvarohandelse har ingenting med behorighet att gora, och
  // en regel pa andelsen hade lagt den i fel hog.
  ok(
    "attendance_incident.revoked är INTE behörighet",
    typFor("attendance_incident.revoked") === "andring",
    String(typFor("attendance_incident.revoked")),
  );

  // Utlamnande gar fore modulens egen natur.
  ok("payroll.exported är utlämnande", typFor("payroll.exported") === "utlamnande");
  ok("journal.viewed är utlämnande", typFor("journal.viewed") === "utlamnande");
  ok("commission.underlag_viewed är utlämnande", typFor("commission.underlag_viewed") === "utlamnande");
  ok("employee.data_export är utlämnande", typFor("employee.data_export") === "utlamnande");
  ok("deviation.viewed är utlämnande", typFor("deviation.viewed") === "utlamnande");

  // Men bara pa hela andelsen eller efter ett understreck. "reviewed" innehaller
  // "viewed" som delstrang — en granskad rutin ar inget utlamnande.
  ok(
    "document.reviewed är INTE utlämnande",
    typFor("document.reviewed") === "andring",
    String(typFor("document.reviewed")),
  );

  ok("team.deleted är radering", typFor("team.deleted") === "radering");
  ok("contract.draft_deleted är radering", typFor("contract.draft_deleted") === "radering");
  ok("consequence_rule.removed är radering", typFor("consequence_rule.removed") === "radering");
  ok("absence.blackout_removed är radering", typFor("absence.blackout_removed") === "radering");

  ok("employee.created är skapande", typFor("employee.created") === "skapande");
  ok("absence.blackout_added är skapande", typFor("absence.blackout_added") === "skapande");
  ok("time.in är skapande", typFor("time.in") === "skapande");
  ok("time.out är skapande", typFor("time.out") === "skapande");
  ok("document.acked är skapande", typFor("document.acked") === "skapande");
  ok("schedule.break_acked är skapande", typFor("schedule.break_acked") === "skapande");
  ok("candidate.hired är skapande", typFor("candidate.hired") === "skapande");

  ok("case.status_changed är ändring", typFor("case.status_changed") === "andring");
  ok("absence.approved är ändring", typFor("absence.approved") === "andring");
  ok("news.published är ändring", typFor("news.published") === "andring");

  // Uppsamlingslaget ar avsiktligt totalt for en KAND modul.
  ok("en ny ändelse i en känd modul blir ändring", typFor("case.nagot_helt_nytt") === "andring");
}

console.log("\n\x1b[1mModulregistret\x1b[0m");
{
  ok("case finns i registret", arModulKand("case.created"), "det var den som fällde första försöket");
  ok("en okänd modul känns igen som okänd", !arModulKand("hittepa.created"));
  ok("modulnamnet är svenskt", modulNamn("commission_bonus_level.set") === "Volymtrappa", modulNamn("commission_bonus_level.set"));
  ok("okänd modul faller tillbaka på prefixet", modulNamn("hittepa.x") === "hittepa");
  ok("registret har inga tomma namn", Object.values(MODUL).every((v) => v.length > 0));
}

console.log("\n\x1b[1mVarje action i KODEN kommer ur en registrerad modul\x1b[0m");

/** Alla .ts/.tsx under src/, rekursivt. */
async function filer(katalog) {
  const ut = [];
  for (const post of await readdir(katalog, { withFileTypes: true })) {
    const vag = join(katalog, post.name);
    if (post.isDirectory()) ut.push(...(await filer(vag)));
    else if (/\.tsx?$/.test(post.name)) ut.push(vag);
  }
  return ut;
}

{
  const funna = new Set();
  for (const f of await filer("src")) {
    const text = await readFile(f, "utf8");
    // Literaler: action: "modul.handelse"
    for (const m of text.matchAll(/action: *"([a-z_]+\.[a-z_]+)"/g)) funna.add(m[1]);
    // Villkorade: action: x ? "a.b" : "c.d" — bada grenarna star som strangar
    // pa raden efter, sa en andra svepning over hela filen tar dem.
    for (const m of text.matchAll(/"([a-z_]+\.[a-z_]+)"/g)) {
      if (arModulKand(m[1]) || /\.(created|updated|deleted|granted|revoked|approved|rejected|closed|paid|drafted|published|resolved|status_changed)$/.test(m[1])) {
        funna.add(m[1]);
      }
    }
    // Mallstrangar med fast prefix: `contract_template.${status}`
    for (const m of text.matchAll(/action: *`([a-z_]+)\.\$\{/g)) funna.add(`${m[1]}.okant`);
  }

  ok("hittade actions i koden", funna.size > 40, `${funna.size} stycken`);

  const okanda = [...funna].filter((a) => !arModulKand(a)).sort();
  ok(
    "varje action i koden kommer ur en registrerad modul",
    okanda.length === 0,
    okanda.length ? `saknas i MODUL: ${okanda.join(", ")}` : "",
  );

  // Alla sju ska ga att na fran koden. En typ som ingenting kan skriva till ar
  // en typ navet pastar sig tacka utan att gora det.
  const typerIKoden = new Set([...funna].map(typFor).filter(Boolean));
  for (const t of TYPER) {
    ok(`typen "${TYP_ETIKETT[t].rubrik}" skrivs någonstans i koden`, typerIKoden.has(t));
  }
}

console.log("\n\x1b[1mVarje action i DATABASEN kommer ur en registrerad modul\x1b[0m");
{
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  const { rows } = await db.query(`select action, count(*)::int as antal from audit_log group by 1`);
  ok("loggen har rader", rows.length > 0, `${rows.length} olika actions`);

  const okanda = rows.map((r) => r.action).filter((a) => !arModulKand(a)).sort();
  ok(
    "varje action i loggen kommer ur en registrerad modul",
    okanda.length === 0,
    okanda.length ? `saknas i MODUL: ${okanda.join(", ")}` : "",
  );

  const oklassade = rows.map((r) => r.action).filter((a) => typFor(a) === null);
  ok("varje action i loggen går att klassa", oklassade.length === 0, oklassade.join(", "));

  const antalPerTyp = new Map();
  for (const r of rows) {
    const t = typFor(r.action);
    if (t) antalPerTyp.set(t, (antalPerTyp.get(t) ?? 0) + r.antal);
  }

  console.log("");
  for (const t of TYPER) {
    console.log(
      `     ${TYP_ETIKETT[t].rubrik.padEnd(24)} ${String(antalPerTyp.get(t) ?? 0).padStart(4)} rader`,
    );
  }
  console.log("");

  // AC-12.1 kraver att typen GAR att logga, inte att den hunnit intraffa. De
  // tre nedan har rader sedan lange och far darfor krava dem — en tom hog dar
  // hade betytt att nagot slutat skriva.
  ok("typen Behörighet har rader", (antalPerTyp.get("behorighet") ?? 0) > 0);
  ok("typen Nytt registrerat har rader", (antalPerTyp.get("skapande") ?? 0) > 0);
  ok("typen Systemhändelse har rader", (antalPerTyp.get("system") ?? 0) > 0);
  ok("typen Utlämnande har rader", (antalPerTyp.get("utlamnande") ?? 0) > 0);

  await db.end();
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
