#!/usr/bin/env node
/**
 * Tolkningen av vaxelns webhook. Ren logik, ingen databas.
 *
 * Det som provas ar de satten en felaktig tolkning kan bli TYST — alltsa ge en
 * rad som ser riktig ut men bar fel uppgift. En kastad exception hade vi sett i
 * `call_ingest.normalize_error`; det har ar de fall som inte kastar.
 *
 *   1. SOMSVARDET FRAN FEL FALT. `id` finns pa allting. Plockas `user.id` far
 *      alla samtal fran samma saljare samma somsvarde, och det unika indexet i
 *      0052 later da varje nytt samtal skriva over det forra. Ett dygns samtal
 *      blir en rad, och ingenting ser trasigt ut.
 *   2. MILLISEKUNDER SOM SEKUNDER. 93000 ar ett rimligt tal for bada, sa ingen
 *      grans i schemat fangar det. Ett samtal pa ett dygn i statistiken.
 *   3. EN ANKNYTNING SOM ETT TELEFONNUMMER. `1042` som `+461042` matchar fel
 *      kund nar samtalet ska paras ihop med en order.
 *   4. TALTID LANGRE AN SAMTALET. Ett tecken pa att fel falt lasts. Villkoret i
 *      0052 hade avvisat raden — och da hade HELA samtalet forsvunnit, inte
 *      bara taltiden.
 *   5. ETT OKANT VARDE SOM BLIR NOLL. `direction` maste bli `okand` och
 *      ravardet sta kvar, annars gar det inte att fa veta vad vaxeln skickar.
 *
 *   node --experimental-strip-types tests/samtal.mjs
 */
import {
  flatta,
  inspelningslage,
  normaliseraNummer,
  sekunder,
  tidpunkt,
  tolkaSamtal,
} from "../src/lib/samtal.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

console.log("\n\x1b[1mPasen plattas ut, hur djup den an ar\x1b[0m");
{
  const k = flatta({ data: { call: { duration: 42 } }, items: [{ id: "a" }] });
  ok("djup nyckel finns som gen vag", k.get("data.call.duration") === 42);
  ok("arrayer far index", k.get("items.0.id") === "a");
  ok("nycklar ar gemener", flatta({ CallId: "x" }).has("callid"));

  // En cirkular struktur ska inte kunna gora mottagningen till en oandlig loop.
  const cirkular = { namn: "a" };
  cirkular.sjalv = cirkular;
  let kraschade = false;
  try {
    flatta(cirkular);
  } catch {
    kraschade = true;
  }
  ok("cirkular struktur kastar inte", !kraschade, "djupet ar begransat till 8");
}

console.log("\n\x1b[1mEtt samtal ur en Lynes-liknande pase\x1b[0m");
{
  const t = tolkaSamtal({
    callId: "abc-123",
    callType: "outbound",
    itemType: "answered",
    user: { id: "u-9", email: "anna@clicknet.se" },
    to: "070-123 45 67",
    startTime: "2026-09-10T08:00:00Z",
    endTime: "2026-09-10T08:01:33Z",
    duration: 93,
    talkTime: 71,
    recordingUrl: "https://media.lynes.io/abc-123.mp3",
  });

  ok("somsvardet ar samtalets id", t.externalRef === "abc-123", `fick ${t.externalRef}`);
  ok("riktningen ar ut", t.direction === "ut");
  ok("utfallet ar besvarat", t.outcome === "besvarat");
  ok("ravardena star kvar", t.rawCallType === "outbound" && t.rawItemType === "answered");
  ok("motparten normaliseras", t.counterpartE164 === "+46701234567", `fick ${t.counterpartE164}`);
  ok("ravardet pa numret star kvar", t.counterpartRaw === "070-123 45 67");
  ok("langden lases", t.durationSeconds === 93);
  ok("taltiden lases", t.talkSeconds === 71);
  ok("starttiden lases", t.startedAt === "2026-09-10T08:00:00.000Z");
  ok("inspelningen finns", t.recordingUrl === "https://media.lynes.io/abc-123.mp3");
  ok("lagets utgangspunkt ar hos vaxeln", inspelningslage(t) === "hos_vaxeln");
}

console.log("\x1b[1m\n1. Somsvardet plockas inte ur ett nastlat id\x1b[0m");
{
  const utan = tolkaSamtal({ user: { id: "u-9" }, itemType: "answered", duration: 10 });
  ok("nastlat user.id blir inte somsvarde", utan.externalRef !== "u-9",
    "annars skriver varje nytt samtal over det forra");

  const med = tolkaSamtal({ id: "s-1", user: { id: "u-9" } });
  ok("men ett id hogst upp duger", med.externalRef === "s-1");

  const sessions = tolkaSamtal({ sessionId: "sess-7", user: { id: "u-9" } });
  ok("sessionId hittas ocksa", sessions.externalRef === "sess-7");
}

console.log("\x1b[1m\n2. Millisekunder gissas inte, de lases ur namnet\x1b[0m");
{
  ok("tal ar sekunder", sekunder(93) === 93);
  ok("ms bara nar den flaggan satts", sekunder(93000, true) === 93);
  ok("strang med siffror", sekunder("93") === 93);
  ok("hh:mm:ss", sekunder("00:01:33") === 93);
  ok("mm:ss", sekunder("1:33") === 93);
  ok("ISO 8601", sekunder("PT1M33S") === 93);
  ok("skrap ger null", sekunder("i gar") === null, "hellre ingen langd an fel langd");

  const t = tolkaSamtal({ durationMs: 93000, itemType: "answered" });
  ok("durationMs raknas om", t.durationSeconds === 93, `fick ${t.durationSeconds}`);

  const u = tolkaSamtal({ duration: 93000, itemType: "answered" });
  ok("duration utan ms i namnet rors inte", u.durationSeconds === 93000,
    "fel varde ar battre an ett pahittat — rapasen gor tolkningen om");
}

console.log("\x1b[1m\n3. En anknytning blir inte ett telefonnummer\x1b[0m");
{
  ok("svenskt mobilnummer", normaliseraNummer("070-123 45 67") === "+46701234567");
  ok("med mellanslag och parentes", normaliseraNummer("(08) 123 456 78") === "+46812345678");
  ok("redan E.164", normaliseraNummer("+46701234567") === "+46701234567");
  ok("00 som prefix", normaliseraNummer("0046701234567") === "+46701234567");
  ok("anknytning ger null", normaliseraNummer("1042") === null, "annars matchar den fel kund");
  ok("dolt nummer ger null", normaliseraNummer("anonymous") === null);
  ok("tomt ger null", normaliseraNummer("") === null);
  ok("for langt ger null", normaliseraNummer("+4670123456789012") === null);
}

console.log("\x1b[1m\n4. Taltid langre an samtalet skrivs inte\x1b[0m");
{
  const t = tolkaSamtal({ duration: 30, talkTime: 300, itemType: "answered" });
  ok("orimlig taltid blir null", t.talkSeconds === null,
    "villkoret i 0052 hade annars avvisat hela samtalet");
  ok("langden star kvar", t.durationSeconds === 30);
}

console.log("\x1b[1m\n5. Okanda varden blir okand, inte noll\x1b[0m");
{
  const t = tolkaSamtal({ callType: "sidledes", itemType: "krumelur", id: "x" });
  ok("riktningen blir okand", t.direction === "okand");
  ok("utfallet blir okant", t.outcome === "okant");
  ok("ravardet star kvar for callType", t.rawCallType === "sidledes",
    "det ar sa vi far veta vad vaxeln egentligen skickar");
  ok("ravardet star kvar for itemType", t.rawItemType === "krumelur");

  const tom = tolkaSamtal({});
  ok("en tom pase kastar inte", tom.direction === "okand" && tom.outcome === "okant");
  ok("en tom pase har inget somsvarde", tom.externalRef === null,
    "servern satter da ett avtryck i stallet");
}

console.log("\n\x1b[1mUtfallen som Lynes v2 skiljer pa\x1b[0m");
{
  const av = (item) => tolkaSamtal({ itemType: item, id: "x" }).outcome;
  ok("answered", av("answered") === "besvarat");
  ok("missed", av("missed") === "missat");
  ok("bounced", av("bounced") === "studsat");
  ok("voicemail", av("voicemail") === "rostbrevlada");
  ok("routed", av("routed") === "kopplat");
  ok("skiftlage spelar ingen roll", av("ANSWERED") === "besvarat");
  ok("bindestreck spelar ingen roll", av("no-answer") === "missat");
}

console.log("\n\x1b[1mRiktningen faller tillbaka pa itemType\x1b[0m");
{
  // Fore v2 bar `callType` riktningen. Star den inte dar far utfallsfaltet
  // forsoka, annars tappas riktningen pa just de aldre posterna.
  const t = tolkaSamtal({ itemType: "inbound", id: "x" });
  ok("inbound i itemType ger riktning in", t.direction === "in");
}

console.log("\n\x1b[1mTidpunkter\x1b[0m");
{
  ok("epoksekunder", tidpunkt(1_757_491_200) === new Date(1_757_491_200_000).toISOString());
  ok("epokmillisekunder", tidpunkt(1_757_491_200_000) === new Date(1_757_491_200_000).toISOString());
  ok("ISO-strang", tidpunkt("2026-09-10T08:00:00Z") === "2026-09-10T08:00:00.000Z");
  ok("skrap ger null", tidpunkt("nyss") === null);
}

console.log("\n\x1b[1mInspelningen maste vara en adress\x1b[0m");
{
  ok("http slapps in", tolkaSamtal({ recordingUrl: "https://a/b.mp3", id: "x" }).recordingUrl === "https://a/b.mp3");
  ok("ett filnamn slapps inte in", tolkaSamtal({ recordingUrl: "b.mp3", id: "x" }).recordingUrl === null,
    "steg 2 hade forsokt hamta den och misslyckats en gang per samtal");
  ok("tom strang ar franvaro", tolkaSamtal({ recordingUrl: "", id: "x" }).recordingUrl === null);
  ok("utan inspelning blir laget ingen", inspelningslage(tolkaSamtal({ id: "x" })) === "ingen");
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom\x1b[0m\n" : `\n\x1b[31m${fel} prov foll\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
