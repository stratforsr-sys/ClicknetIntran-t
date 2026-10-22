#!/usr/bin/env node
/**
 * Inloggningens regler. Ren logik, inga beroenden.
 *
 *   node --experimental-strip-types tests/inloggning.mjs
 *
 * Det som sidan, actions och mellanvaran delar (src/lib/inloggning.ts) och
 * "Föreslå ett åt mig" (src/lib/losenordsforslag.ts), mejlet med koden
 * (src/lib/kodbrev.ts) och urtavlans dagsljus (src/lib/dagsljus.ts). Tiderna räknas i svensk
 * tid oavsett serverns zon, så provet ska ge samma svar med TZ=UTC som med
 * TZ=America/New_York.
 */
import {
  DOMAN,
  avatarFarg,
  dagText,
  datumText,
  foreslaRattning,
  fornamn,
  halsning,
  iStockholm,
  initialer,
  isoVecka,
  klockslag,
  kvarText,
  lasKonto,
  liknarEpost,
  malNamn,
  normaliseraEpost,
  oppnarText,
  sakerNasta,
  sekunderUrFel,
  senastText,
  skrivKonto,
  tolkaAuthFel,
} from "../src/lib/inloggning.ts";
import { ORD, foreslaLosenord } from "../src/lib/losenordsforslag.ts";
import { kodbrev } from "../src/lib/kodbrev.ts";
import { granska } from "../src/lib/losenordskrav.ts";
import { aretsDagsljus, andringText, dagIAret, dagarIAret, langdText, narmasteMinut, solTider } from "../src/lib/dagsljus.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const lika = (namn, fick, vantat) => ok(namn, fick === vantat, fick === vantat ? "" : `fick ${JSON.stringify(fick)}, väntat ${JSON.stringify(vantat)}`);

console.log("\n\x1b[1mAdressen\x1b[0m");
{
  lika("bara förnamnet får domänen", normaliseraEpost("Zen"), `zen@${DOMAN}`);
  lika("mellanslag och versaler bort", normaliseraEpost("  Zen@Clicknet.SE "), "zen@clicknet.se");
  lika("en annan domän lämnas", normaliseraEpost("zen@gmail.com"), "zen@gmail.com");
  lika("tomt blir tomt", normaliseraEpost(null), "");
  // Det som inte går att tolka lämnas, och Supabase nekar det med navets ord.
  lika("två ord gissas inte till en adress", normaliseraEpost("zen svensson"), "zen svensson");
  ok("en adress liknar en adress", liknarEpost("zen@clicknet.se"));
  ok("utan domän liknar det inte", !liknarEpost("zen@clicknet"));
  ok("över 254 tecken nekas", !liknarEpost(`${"a".repeat(250)}@clicknet.se`));
}

console.log("\n\x1b[1mSkrivfel i domänen\x1b[0m");
{
  lika(".com i stället för .se", foreslaRattning("zen@clicknet.com"), "zen@clicknet.se");
  lika("två bokstäver bytta", foreslaRattning("zen@clikcnet.se"), "zen@clicknet.se");
  lika("en bokstav för mycket", foreslaRattning("zen@clicknett.se"), "zen@clicknet.se");
  lika("k i stället för c", foreslaRattning("zen@klicknet.se"), "zen@clicknet.se");
  lika("ändelsen saknas", foreslaRattning("zen@clicknet"), "zen@clicknet.se");
  lika("rätt adress får inget förslag", foreslaRattning("zen@clicknet.se"), null);
  // Det viktiga: en riktig annan adress "rättas" aldrig.
  lika("gmail rättas inte", foreslaRattning("zen@gmail.com"), null);
  lika("icloud rättas inte", foreslaRattning("zen@icloud.com"), null);
  lika("ett halvt ord rättas inte", foreslaRattning("zen@click.se"), null);
  lika("utan snabel-a inget förslag", foreslaRattning("zen"), null);
}

console.log("\n\x1b[1mVart man skickas (öppen vidarebefordran)\x1b[0m");
{
  lika("en väg inom navet släpps", sakerNasta("/kalender?dag=2026-10-21"), "/kalender?dag=2026-10-21");
  lika("Nav 2.0 med vy släpps", sakerNasta("/nav2?till=%2Forder"), "/nav2?till=%2Forder");
  for (const [namn, v] of [
    ["två snedstreck (annan värd)", "//evil.se"],
    ["snedstreck och bakstreck (annan värd)", "/\\evil.se"],
    ["bakstreck längre in", "/kalender\\..\\evil"],
    ["snabel-a (användardel i adressen)", "@evil.se"],
    ["hel adress", "https://evil.se"],
    ["javascript:", "javascript:alert(1)"],
    ["styrtecken", "/kalender\n"],
    ["nolltecken", "/kalender\u0000"],
    ["startsidan (skickar vidare igen)", "/"],
    ["inloggningen själv", "/logga-in"],
    ["steg två", "/logga-in/verifiera"],
    ["auth-vägarna", "/auth/bekrafta"],
    ["tomt", ""],
  ]) {
    lika(`${namn} ger navet`, sakerNasta(v), "/nav2");
  }
  lika("saknas ger navet", sakerNasta(undefined), "/nav2");
  lika("en egen reserv går att ange", sakerNasta("//x", "/byt-losenord"), "/byt-losenord");
}

console.log("\n\x1b[1mVyn efter inloggningen\x1b[0m");
{
  lika("kalendern", malNamn("/kalender?dag=2026-10-21"), "Kalendern");
  lika("Nav 2.0 med till=", malNamn("/nav2?till=%2Forder"), "Order");
  lika("till= med en underväg", malNamn("/nav2?till=/personal/abc"), "Anställda");
  lika("navet självt", malNamn("/nav2"), null);
  lika("okänd väg", malNamn("/okand"), null);
  lika("texten medan sidan laddas", oppnarText("/kalender"), "Öppnar Kalendern…");
  lika("och för navet", oppnarText("/nav2"), "Öppnar navet…");
}

console.log("\n\x1b[1mTid i svensk tid\x1b[0m");
{
  const t = (iso) => new Date(iso);
  lika("vintertid: 06:05 UTC är 07:05", klockslag(t("2026-01-15T06:05:00Z")), "07:05");
  lika("sommartid: 06:05 UTC är 08:05", klockslag(t("2026-06-15T06:05:00Z")), "08:05");
  // 2026-03-29 02:00 vintertid → 03:00 sommartid; 2026-10-25 03:00 → 02:00.
  lika("över vårens timme", klockslag(t("2026-03-29T01:30:00Z")), "03:30");
  lika("höstens första 02:30", klockslag(t("2026-10-25T00:30:00Z")), "02:30");
  lika("höstens andra 02:30", klockslag(t("2026-10-25T01:30:00Z")), "02:30");
  lika("midnatt i Stockholm är förra dygnet i UTC", iStockholm(t("2026-10-20T22:30:00Z")).dag, 21);
  lika("ISO-vecka mitt i året", isoVecka(2026, 10, 21), 43);
  lika("nyårsdagen 2027 hör till vecka 53", isoVecka(2027, 1, 1), 53);
  lika("30 december 2024 är vecka 1", isoVecka(2024, 12, 30), 1);
  lika("hälsning 09:59", halsning(9 * 60 + 59), "God morgon");
  lika("hälsning 10:00", halsning(10 * 60), "God eftermiddag");
  lika("hälsning 17:59", halsning(17 * 60 + 59), "God eftermiddag");
  lika("hälsning 18:00", halsning(18 * 60), "God kväll");
  lika("datumraden", dagText(t("2026-10-21T10:00:00Z")), "Onsdag 21 oktober · vecka 43");
  lika("datumraden strax efter midnatt", dagText(t("2026-10-20T22:30:00Z")), "Onsdag 21 oktober · vecka 43");

  const nu = t("2026-10-21T12:00:00Z");
  lika("senast i dag", senastText(t("2026-10-21T06:12:00Z"), nu), "i dag 08:12");
  lika("senast i går", senastText(t("2026-10-20T14:40:00Z"), nu), "i går 16:40");
  lika("senast i söndags", senastText(t("2026-10-18T07:00:00Z"), nu), "i söndags 09:00");
  lika("en vecka bort: datumet", senastText(t("2026-10-13T07:00:00Z"), nu), "13 oktober");
  lika("förra året: med året", senastText(t("2025-12-30T07:00:00Z"), nu), "30 december 2025");
  lika("datum i år", datumText(t("2026-11-20T10:00:00Z"), nu), "20 november");
  lika("datum nästa år", datumText(t("2027-01-04T10:00:00Z"), nu), "4 januari 2027");
  lika("nedräkning 42 s", kvarText(42), "0:42");
  lika("nedräkning 75 s", kvarText(75), "1:15");
  lika("nedräkningen avrundar uppåt", kvarText(59.2), "1:00");
  lika("aldrig under noll", kvarText(-3), "0:00");
}

console.log("\n\x1b[1mSupabases fel\x1b[0m");
{
  const typ = (e) => tolkaAuthFel(e).typ;
  lika("fel lösenord", typ({ code: "invalid_credentials", status: 400, message: "Invalid login credentials" }), "fel");
  lika("utan kod: meddelandet", typ({ status: 400, message: "Invalid login credentials" }), "fel");
  lika("fel eller utgången kod", typ({ code: "otp_expired", status: 403, message: "Token has expired or is invalid" }), "kod");
  lika("okänd adress vid kod", typ({ code: "otp_disabled", status: 422, message: "Signups not allowed for otp" }), "okant");
  lika("avstängt konto", typ({ code: "user_banned", status: 400, message: "User is banned" }), "avstangd");
  const sparr = tolkaAuthFel({
    code: "over_email_send_rate_limit",
    status: 429,
    message: "For security purposes, you can only request this after 42 seconds.",
  });
  ok("spärren per adress ger sekunderna", sparr.typ === "sparr" && sparr.sekunder === 42, JSON.stringify(sparr));
  lika("mejlgränsen för hela projektet", typ({ code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" }), "mejlgrans");
  const forMycket = tolkaAuthFel({ code: "over_request_rate_limit", status: 429, message: "Request rate limit reached" });
  ok("för många försök utan tid: en minut", forMycket.typ === "sparr" && forMycket.sekunder === 60, JSON.stringify(forMycket));
  lika("tjänsten nere", typ({ status: 500, message: "Internal Server Error" }), "tjanst");
  lika("inget svar alls", typ({ status: 0, message: "fetch failed" }), "tjanst");
  lika("sekunder ur texten", sekunderUrFel("only request this after 1 second"), 1);
  lika("taket är en timme", sekunderUrFel("after 99999 seconds"), 3600);
  lika("ingen tid i texten", sekunderUrFel("Request rate limit reached"), null);
}

console.log("\n\x1b[1mKontot på enheten\x1b[0m");
{
  const konto = { epost: "anna@clicknet.se", namn: "Anna Svensson", senast: "2026-10-21T06:12:00.000Z" };
  const tillbaka = lasKonto(skrivKonto(konto));
  ok("skrivs och läses tillbaka", JSON.stringify(tillbaka) === JSON.stringify(konto), JSON.stringify(tillbaka));
  lika("ingen kaka", lasKonto(undefined), null);
  lika("trasig kaka", lasKonto("{inte json"), null);
  lika("en adress som inte är en adress", lasKonto(JSON.stringify({ e: "<script>", n: "x" })), null);
  lika("ett orimligt långt namn kastas", lasKonto(JSON.stringify({ e: "zen", n: "x".repeat(81) }))?.namn, null);
  lika("en trasig tid kastas", lasKonto(JSON.stringify({ e: "zen", t: "i går" }))?.senast, null);
  lika("adressen fylls i som i formuläret", lasKonto(JSON.stringify({ e: "Zen" }))?.epost, "zen@clicknet.se");
  lika("förnamnet", fornamn("Anna Svensson"), "Anna");
  lika("inget namn, inget förnamn", fornamn(null), null);
  lika("initialerna", initialer("Anna Svensson"), "AS");
  lika("bara två initialer", initialer("Anna Maria Svensson"), "AM");
  // Samma färg som Nav 2.0:s avatar(): AVC[namnets längd % 8].
  lika("avatarens färg som i Nav 2.0", avatarFarg("Anna Svensson"), "#9A3412");
}

console.log("\n\x1b[1mFöreslå ett åt mig\x1b[0m");
{
  ok("ordlistan har inga dubbletter", new Set(ORD).size === ORD.length, `${ORD.length} ord`);
  ok("och inga å, ä eller ö", ORD.every((o) => !/[åäöÅÄÖ]/.test(o)));
  ok("och bara bokstäver, med versal först", ORD.every((o) => /^[A-Z][a-z]+$/.test(o)));
  const forslag = Array.from({ length: 500 }, () => foreslaLosenord());
  ok("formen: fyra ord och ett tal", forslag.every((f) => /^([A-Z][a-z]+-){4}[1-9]\d$/.test(f)), forslag[0]);
  ok("orden kommer ur listan", forslag.every((f) => f.split("-").slice(0, 4).every((o) => ORD.includes(o))));
  ok("inget ord två gånger", forslag.every((f) => new Set(f.split("-").slice(0, 4)).size === 4));
  ok("500 förslag, 500 olika", new Set(forslag).size === forslag.length);
  ok("varje förslag klarar lösenordskraven", forslag.every((f) => granska(f).ok), forslag.find((f) => !granska(f).ok) ?? "");
  const bitar = Math.log2(ORD.length * (ORD.length - 1) * (ORD.length - 2) * (ORD.length - 3) * 90);
  ok("minst 36 bitar slump", bitar >= 36, `${bitar.toFixed(1)} bitar`);
}

console.log("\n\x1b[1mMejlet med koden\x1b[0m");
{
  const b = kodbrev("482913", "Anna", "logga-in", "10:02");
  ok("koden först i ämnesraden (syns i aviseringen)", b.amne === "482913 är din kod till Clicknet Nav", b.amne);
  ok("texten: hälsning, koden och tiden", b.text.startsWith("Hej Anna,") && b.text.includes("Din kod till Clicknet Nav: 482913") && b.text.includes("gäller till 10:02"));
  ok("HTML: koden, tiden och navets band", b.html.includes(">482913<") && b.html.includes("10:02") && b.html.includes("#0F2A22"));
  ok("utan namn: bara Hej", kodbrev("1", null, "glomt", "x").text.startsWith("Hej,"));
  const syften = ["logga-in", "glomt", "byte", "steg2"].map((s) => kodbrev("1", "A", s, "x").text.split("\n")[4]);
  ok("varje syfte har sin egen rad", new Set(syften).size === 4, syften.join(" | "));
  const farligt = kodbrev("1", "<b>Anna</b> & co", "logga-in", "x");
  ok("namnet escapas i HTML", farligt.html.includes("&lt;b&gt;Anna&lt;/b&gt; &amp; co") && !farligt.html.includes("<b>Anna"));
  ok("inga mallrester", !/\{\{|undefined|null/.test(b.html + b.text));
  ok("ett ord om vad man gör om man inte bett om koden", b.text.includes("strunta i mejlet"));
}

console.log("\n\x1b[1mDagsljuset i Stockholm (urtavlan)\x1b[0m");
{
  // Klockslaget i svensk tid, på sekunden.
  const sek = (tid) => {
    const d = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(tid);
    const t = (typ) => Number(d.find((x) => x.type === typ).value);
    return t("hour") * 3600 + t("minute") * 60 + t("second");
  };
  const hms = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, "0")).join(":");
  const tal = (t) => t.split(":").reduce((a, x) => a * 60 + Number(x), 0);
  // Facit från api.sunrise-sunset.org för Stockholm (59.3293, 18.0686), i svensk tid.
  const facit = [
    ["vårdagjämningen", 2026, 3, 20, "05:48:56", "18:01:27"],
    ["midsommar", 2026, 6, 21, "03:30:49", "22:08:15"],
    ["en dag i oktober", 2026, 10, 21, "07:40:08", "17:24:34"],
    ["midvintern", 2026, 12, 21, "08:43:09", "14:48:22"],
  ];
  for (const [namn, ar, manad, dag, upp, ned] of facit) {
    const t = solTider(ar, manad, dag);
    const du = Math.abs(sek(t.upp) - tal(upp));
    const dn = Math.abs(sek(t.ned) - tal(ned));
    ok(`${namn}: inom en minut från facit`, du <= 60 && dn <= 60, `upp ${hms(sek(t.upp))} (${upp}), ned ${hms(sek(t.ned))} (${ned})`);
  }
  const kiruna = { lat: 67.855, lon: 20.225 };
  ok("midnattssol i Kiruna: ingen tid", solTider(2026, 6, 21, kiruna) === null);
  ok("polarnatt i Kiruna: ingen tid", solTider(2026, 12, 21, kiruna) === null);
  lika("2026 har 365 dagar", dagarIAret(2026), 365);
  lika("2028 har 366", dagarIAret(2028), 366);
  lika("2100 har 365 (sekelår)", dagarIAret(2100), 365);
  lika("1 januari är dag 0", dagIAret(2026, 1, 1), 0);
  lika("nyårsafton ett skottår är dag 365", dagIAret(2028, 12, 31), 365);
  const ljus = aretsDagsljus(2026);
  const langst = ljus.indexOf(Math.max(...ljus));
  const kortast = ljus.indexOf(Math.min(...ljus));
  ok("längsta dagen vid midsommar", langst >= 169 && langst <= 172, `dag ${langst}`);
  ok("kortaste dagen vid midvintern", kortast >= 353 && kortast <= 356, `dag ${kortast}`);
  lika("midsommardagen", langdText(ljus[langst]), "18 t 37 min");
  lika("midvinterdagen", langdText(ljus[kortast]), "6 t 5 min");
  lika("under en timme", langdText(42), "42 min");
  lika("59,6 minuter avrundas till en timme", langdText(59.6), "1 t 0 min");
  lika("kortare än i går", andringText(583.4, 588.6), "5 min kortare än i går");
  lika("längre än i går", andringText(600, 597.2), "3 min längre än i går");
  lika("vid solståndet: sekunder", andringText(1117.2, 1117.1), "nästan lika lång som i går");
  lika("till närmaste minut, nedåt", narmasteMinut(new Date("2026-10-21T05:40:29Z")).toISOString(), "2026-10-21T05:40:00.000Z");
  lika("till närmaste minut, uppåt", narmasteMinut(new Date("2026-10-21T05:40:31Z")).toISOString(), "2026-10-21T05:41:00.000Z");
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} kontroll(er) underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
