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
  omtagIOmgangar,
  omtagsLarm,
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
  // Starttiden är med för att påsen ska vara ett samtal alls (gul 10, nedan).
  const utan = tolkaSamtal({ user: { id: "u-9" }, itemType: "answered", duration: 10, startTime: 1_757_491_200_000 });
  ok("nastlat user.id blir inte somsvarde", utan.externalRef !== "u-9",
    "annars skriver varje nytt samtal over det forra");

  const med = tolkaSamtal({ id: "s-1", user: { id: "u-9" } });
  ok("men ett id hogst upp duger", med.externalRef === "s-1");

  const sessions = tolkaSamtal({ sessionId: "sess-7", user: { id: "u-9" } });
  ok("sessionId hittas ocksa", sessions.externalRef === "sess-7");
}

console.log("\n\x1b[1mEN RIKTIG LYNES-PASE, avlast ur produktion 2026-09-11\x1b[0m");
{
  // Kopierad ur `call_ingest` efter att Lynes slog pa webhooken. Falten ar
  // identiska i alla sexton forsta leveranserna. Adressen ar forkortad.
  //
  // Det har provet ar det enda som star mellan tolken och en tyst regression:
  // de sexton forsta samtalen tolkades med noll fel och anda fel varde i
  // nastan varje kolumn, for varje gissning gav `null` i stallet for att kasta.
  const t = tolkaSamtal({
    id: 486191227,
    userId: "fb15ca20-1893-48da-9ed0-6d49180c0087",
    agentId: null,
    endTime: 1789109939000,
    fileUrls: ["https://s3.eu-north-1.amazonaws.com/easyteams.recorded-calls/00742161.mp3?X-Amz-Expires=1800"],
    talkTime: 407000,
    waitTime: null,
    agentName: null,
    aiAgentId: null,
    direction: "OUTGOING_CALL",
    startTime: 1789109532000,
    recorderId: "simon@clicknet.se",
    referredBy: null,
    referredTo: null,
    aiAgentName: null,
    aiAgentRole: null,
    calleeNumber: "+46793564194",
    callerNumber: "+46768748198",
    answerGroupId: null,
    answerGroupName: null,
  });

  ok("id:t blir somsvarde aven som tal", t.externalRef === "486191227", `fick ${t.externalRef}`);
  ok("OUTGOING_CALL blir ut", t.direction === "ut", `fick ${t.direction}`);
  ok("ravardet star kvar", t.rawCallType === "OUTGOING_CALL");
  ok("recorderId blir avsandare, inte userId", t.agentRef === "simon@clicknet.se",
    `fick ${t.agentRef} — en uuid har kopplar ingen person`);
  ok("motparten ar den uppringde", t.counterpartE164 === "+46793564194",
    `fick ${t.counterpartE164} — callerNumber ar var egen saljare`);
  ok("langden raknas ur klockslagen", t.durationSeconds === 407,
    `fick ${t.durationSeconds} — nagon duration finns inte i pasen`);
  ok("taltiden lases som millisekunder", t.talkSeconds === 407,
    `fick ${t.talkSeconds} — 407000 som sekunder ar fyra dygn`);
  ok("starttiden lases ur epokmillisekunder", t.startedAt === new Date(1789109532000).toISOString());
  ok("sluttiden lases", t.endedAt === new Date(1789109939000).toISOString());
  ok("inspelningen plockas ur arrayen", t.recordingUrl?.startsWith("https://s3.eu-north-1"),
    `fick ${t.recordingUrl} — fileUrls ar en array`);
  ok("laget blir hos vaxeln", inspelningslage(t) === "hos_vaxeln");
  ok("utfallet ar okant och det ar ratt", t.outcome === "okant",
    "inspelningswebhooken bar inget itemType — det gor Insights-webhooken");
}

{
  // Samma pase, inkommande. Da ar motparten den som RINGDE.
  const t = tolkaSamtal({
    id: 1, direction: "INCOMING_CALL", recorderId: "simon@clicknet.se",
    startTime: 1789109532000, endTime: 1789109592000, talkTime: 55000,
    callerNumber: "+46793564194", calleeNumber: "+46768748198",
  });
  ok("INCOMING_CALL blir in", t.direction === "in");
  ok("motparten ar den som ringde", t.counterpartE164 === "+46793564194", `fick ${t.counterpartE164}`);
  ok("langden blir 60", t.durationSeconds === 60);
  ok("taltiden blir 55", t.talkSeconds === 55);
}

console.log("\n\x1b[1mEN RIKTIG INSIGHTS-PASE, avlast ur produktion 2026-09-11\x1b[0m");
{
  // Lynes andra webhook. Samma samtal fanns samtidigt i inspelningsflodet med
  // samma userId, samma startTime pa millisekunden och samma nummer — det ar
  // den jamforelsen som avgjorde vilket falt som betyder vad.
  const t = tolkaSamtal({
    body: "Call to: +46723160111\nCall from user: mick@clicknet.se (+46102093116)\nCall type: Inbound",
    userId: "6a59288e-d5e9-40c3-aa1c-1dd828fb31ce",
    callType: "Inbound",
    duration: 62000,
    itemType: "OUTGOING_CALL",
    toNumber: "+46723160111",
    startTime: 1789132253000,
    fromNumber: "+46102093116",
  });

  ok("itemType avgor riktningen, inte callType", t.direction === "ut",
    `fick ${t.direction} — callType sa "Inbound" men samtalet gick ut`);
  ok("motparten ar kunden, inte vart eget nummer", t.counterpartE164 === "+46723160111",
    `fick ${t.counterpartE164}`);
  ok("duration lases som millisekunder", t.durationSeconds === 62,
    `fick ${t.durationSeconds} — 62000 som sekunder ar sjutton timmar`);
  ok("bada ravardena star kvar", t.rawItemType === "OUTGOING_CALL" && t.rawCallType === "Inbound");
  ok("utfallet ar okant", t.outcome === "okant",
    "ingen av de tva formerna har sagt besvarat eller missat om ett samtal an");
  ok("uuid:t blir avsandare nar ingen e-post finns", t.agentRef === "6a59288e-d5e9-40c3-aa1c-1dd828fb31ce",
    "Insights-pasen har bara e-posten inbakad i en fritext");
  ok("och da ar agentUserId null", t.agentUserId === null,
    "samma varde pa tva stallen ar tva stallen att halla lika — bron gar via identitetsformer()");
  ok("ingen nyckel i pasen", t.externalRef === null,
    "servern satter ett avtryck — se NASTA_SESSION om hopslagningen");
}

{
  // Nar bada finns ska agentUserId inte duplicera agentRef.
  const t = tolkaSamtal({ id: 1, recorderId: "mick@clicknet.se", userId: "6a59288e" });
  ok("agentRef ar e-posten", t.agentRef === "mick@clicknet.se");
  ok("agentUserId ar uuid:t", t.agentUserId === "6a59288e");

  const bara = tolkaSamtal({ id: 2, userId: "6a59288e" });
  ok("utan e-post blir uuid:t agentRef", bara.agentRef === "6a59288e");
  ok("och da ar agentUserId null", bara.agentUserId === null,
    "samma varde pa tva stallen ar tva stallen att halla lika");
}

console.log("\x1b[1m\n1b. Den som ringde hittas aven nastlat, och e-posten gar fore id:t\x1b[0m");
{
  // Hittat i produktion 2026-09-10: `user.email` ar EN nyckel i den utplattade
  // kartan, inte tva. Ett `useremail` utan punkt traffar den inte, och da blir
  // varje samtal okopplat — vilket bara syns som att statistiken ar tom.
  const nastlad = tolkaSamtal({ callId: "x", user: { id: "u-1", email: "anna@clicknet.se" } });
  ok("nastlad user.email hittas", nastlad.agentRef === "anna@clicknet.se",
    `fick ${nastlad.agentRef}`);

  const platt = tolkaSamtal({ callId: "x", userEmail: "anna@clicknet.se" });
  ok("platt userEmail hittas ocksa", platt.agentRef === "anna@clicknet.se");

  const djupt = tolkaSamtal({ callId: "x", data: { user: { email: "anna@clicknet.se" } } });
  ok("annu djupare hittas", djupt.agentRef === "anna@clicknet.se");

  ok("e-posten gar fore id:t", nastlad.agentRef !== "u-1",
    "ett internt vaxel-id kopplar ingen forran nagon lagt en phone_identity");

  const baraId = tolkaSamtal({ callId: "x", user: { id: "u-1" } });
  ok("utan e-post duger id:t", baraId.agentRef === "u-1");

  const utan = tolkaSamtal({ callId: "x" });
  ok("utan avsandare blir det null", utan.agentRef === null,
    "samtalet sparas okopplat, det ar inte ett fel");
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

  const t = tolkaSamtal({ id: "x", durationMs: 93000, itemType: "answered" });
  ok("durationMs raknas om", t.durationSeconds === 93, `fick ${t.durationSeconds}`);

  // ANDRAT 2026-09-11. Provet krade forut att `duration: 93000` star kvar som
  // 93000 sekunder, for regeln var "rakna bara om nar namnet sager ms". Lynes
  // Insights-pase bevisade motsatsen: den bar `duration: 62000` for ett samtal
  // som inspelningsflodet samtidigt redovisade som 62 sekunder. Hos Lynes ar
  // ALLA tider millisekunder, ocksa de som inte heter sa.
  const u = tolkaSamtal({ id: "x", duration: 93000, itemType: "answered" });
  ok("duration utan fonster lases som millisekunder", u.durationSeconds === 93,
    `fick ${u.durationSeconds}`);

  // Men en langd som rundar till noll som ms var aldrig ms.
  const v = tolkaSamtal({ id: "x", duration: 93, itemType: "answered" });
  ok("en liten duration star kvar som sekunder", v.durationSeconds === 93,
    "93 ms hade blivit ett nollat samtal, och det ar en uppgift som forsvunnit");
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
  const t = tolkaSamtal({ id: "x", duration: 30, talkTime: 300, itemType: "answered" });
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

  // ANDRAT 2026-10-31 (gul 10). Förut kastade en tom påse inte, och servern gav
  // den ett avtryck. Då blev `{"prov":"…"}` ett samtal. Nu är den ett tolkfel:
  // råraden står kvar i call_ingest, och inget phone_call skrivs.
  let tomKastade = false;
  try {
    tolkaSamtal({});
  } catch {
    tomKastade = true;
  }
  ok("en tom pase kastar", tomKastade, "varken samtals-id eller starttid");
  const baraTid = tolkaSamtal({ startTime: 1_757_491_200_000 });
  ok("en pase med bara tiden har inget somsvarde", baraTid.externalRef === null,
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

console.log("\n\x1b[1mUtan både samtals-id och starttid är påsen inte ett samtal (gul 10)\x1b[0m");
{
  // Produktionsprovet 2026-10-30: {"prov":"…"} blev ett phone_call med riktning okand.
  let kastade = null;
  try {
    tolkaSamtal({ prov: "x" });
  } catch (e) {
    kastade = e.message;
  }
  ok("en påse utan id och tid kastar", kastade === "Påsen har varken samtals-id eller starttid.", kastade ?? "kastade inte");
  ok("bara id:t räcker", tolkaSamtal({ id: "515293370" }).externalRef === "515293370");
  ok("bara starttiden räcker", tolkaSamtal({ startTime: 1_757_491_200_000 }).startedAt === new Date(1_757_491_200_000).toISOString());
  // En påse som inspelningsflödets (formen 2026-10-30, påhittade nummer): tolkas som förut.
  const riktig = tolkaSamtal({
    id: 515339662, userId: "82b1d6be-4f94-463c-af3c-3c21052031a1", recorderId: "fredrik@clicknet.se",
    direction: "OUTGOING_CALL", startTime: 1_761_854_400_000, endTime: 1_761_854_807_000, talkTime: 407_000,
    fromNumber: "+46700000000", toNumber: "+46701234567",
  });
  ok(
    "en riktig påse tolkas som förut",
    riktig.externalRef === "515339662" && riktig.direction === "ut" && riktig.durationSeconds === 407 && riktig.agentRef === "fredrik@clicknet.se",
    JSON.stringify({ ref: riktig.externalRef, dir: riktig.direction, s: riktig.durationSeconds, agent: riktig.agentRef }),
  );
}

console.log("\n\x1b[1mNattens omtag går igenom alla råpåsar, i omgångar (rättelserna 2026-11-02)\x1b[0m");
{
  // 450 otolkade rader, där de 210 äldsta aldrig går att tolka. Förut tog natten de 200 äldsta och
  // inget mer: de nyare kom aldrig fram, och felen syntes inte någonstans.
  const rader = Array.from({ length: 450 }, (_, i) => ({ id: 1000 + i }));
  const hamta = async (efter, antal) => rader.filter((r) => r.id > efter).slice(0, antal);
  const tolkade = [];
  const tolka = async (r) => {
    if (r.id < 1210) throw new Error(`new row for relation "phone_call" violates check constraint "phone_call_inspelning"`);
    tolkade.push(r.id);
  };
  const r = await omtagIOmgangar(hamta, tolka, { antal: 200, senast: Infinity });
  ok("alla 450 rader prövas", r.tolkade + r.fel.length === 450, `${r.tolkade} + ${r.fel.length}`);
  ok("de nyaste blir samtal trots 210 trasiga före dem", tolkade.includes(1449) && r.tolkade === 240, String(r.tolkade));
  ok("och omtaget hann igenom", r.hann === true);

  let klocka = 0;
  const tidsbrist = await omtagIOmgangar(hamta, async () => { klocka += 10; }, { antal: 200, senast: 1000, nu: () => klocka });
  ok("tiden tar slut: det sägs, i stället för att jobbet tystnar", tidsbrist.hann === false && tidsbrist.tolkade === 100, JSON.stringify({ hann: tidsbrist.hann, n: tidsbrist.tolkade }));

  let felIFragan = "";
  try {
    await omtagIOmgangar(async () => { throw new Error("call_ingest: timeout"); }, tolka, { antal: 200, senast: Infinity });
  } catch (e) {
    felIFragan = e.message;
  }
  ok("ett fel i frågan kastas, så att natten larmar", felIFragan === "call_ingest: timeout", felIFragan || "kastade inte");

  ok("inget att larma om när allt gick", omtagsLarm({ tolkade: 3, fel: [], hann: true }) === null);
  const larm = omtagsLarm(r);
  ok("trasiga påsar ger ett larm med antal och det första felet", larm !== null && larm.includes("210") && larm.includes("phone_call_inspelning"), String(larm));
  ok("tidsbrist ger ett larm", (omtagsLarm(tidsbrist) ?? "").includes("hann inte"), String(omtagsLarm(tidsbrist)));
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom\x1b[0m\n" : `\n\x1b[31m${fel} prov foll\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
