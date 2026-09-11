/**
 * Tolkningen av vad växeln skickar. Ren logik, inga importer.
 *
 * ===========================================================================
 * FORMEN ÄR INTE LÄNGRE EN GISSNING — DEN ÄR AVLÄST UR RIKTIG TRAFIK
 *
 * Filen skrevs 2026-09-10 mot ett odokumenterat format. 2026-09-11 slog Lynes
 * på webhooken, sexton samtal kom in, och råpåsen visade att nästan varje
 * gissning var fel. Så här ser en riktig leverans ut (fälten är identiska i
 * alla sexton):
 *
 *   id             486191227                      ← number, inte sträng
 *   direction      "OUTGOING_CALL"                ← inte "outbound"
 *   recorderId     "simon@clicknet.se"            ← DET är e-postadressen
 *   userId         "fb15ca20-1893-…"              ← Lynes interna id
 *   agentId        null                           ← alltid null hittills
 *   startTime      1789109532000                  ← epok i millisekunder
 *   endTime        1789109939000
 *   talkTime       407000                         ← MILLISEKUNDER, utan att
 *                                                   namnet säger det
 *   waitTime       null
 *   callerNumber   "+46768748198"
 *   calleeNumber   "+46793564194"
 *   fileUrls       ["https://s3.eu-north-1.amazonaws.com/…"]   ← en ARRAY
 *   answerGroupId / answerGroupName / referredBy / referredTo /
 *   aiAgentId / aiAgentName / aiAgentRole / agentName          ← null hittills
 *
 * NÅGON `duration` FINNS INTE. Längden är `endTime - startTime`, och den
 * räknas fram nedan.
 *
 * NÅGOT UTFALL FINNS INTE HELLER. Det här är inspelningswebhooken; `callType`
 * och `itemType` hör till Lynes *Insights*-webhook, som är en annan påslagning.
 * `outcome` står därför kvar på `okant` för allt som kommer den här vägen, och
 * det är ett ärligt svar och inte ett fel.
 *
 * ===========================================================================
 * VARFÖR DEN HÄR FILEN ÄNDÅ LETAR I STÄLLET FÖR ATT LÄSA
 *
 * Kandidatlistorna står kvar, med de riktiga namnen först. Att byta ut dem mot
 * `payload.recorderId` hade gjort filen kortare och spröd: Lynes har redan
 * ändrat formatet en gång (`itemType` tillkom i v2), och nästa ändring ska ge
 * ett fält som inte hittas — inte en TypeError mitt i mottagningen.
 *
 * Och `call_ingest` behåller råpåsen. Det var det som räddade de sexton första
 * samtalen: när tolkningen visade sig fel gick de att tolka om ur påsen, utan
 * att en enda uppgift behövt vara sparad två gånger.
 *
 * ===========================================================================
 * `okand` OCH `okant` ÄR SVAR, INTE FEL
 *
 * Ett värde vi inte känner igen får inte bli noll och inte heller en kastad
 * exception. Riktningen blir `okand`, utfallet `okant`, och råvärdet står kvar
 * i `raw_call_type` / `raw_item_type`. Då syns det i en `group by` dagen efter
 * — vilket är hur vi får veta vad växeln egentligen skickar.
 */

export type Riktning = "in" | "ut" | "okand";

export type Utfall =
  | "besvarat"
  | "missat"
  | "studsat"
  | "rostbrevlada"
  | "kopplat"
  | "okant";

export type Tolkning = {
  externalRef: string | null;
  direction: Riktning;
  outcome: Utfall;
  rawCallType: string | null;
  rawItemType: string | null;
  agentRef: string | null;
  counterpartRaw: string | null;
  counterpartE164: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  talkSeconds: number | null;
  recordingUrl: string | null;
};

/* ------------------------------------------------------------------------- *
 * Att hitta ett fält
 * ------------------------------------------------------------------------- */

/**
 * Plattar ut påsen till `{ "data.call.duration": 42 }`, med nycklarna i gemener.
 *
 * Arrayer plattas med index (`items.0.id`). Djupet är begränsat: en webhook som
 * skickar en cirkulär eller absurt djup struktur ska inte kunna göra
 * mottagningen till en oändlig loop.
 */
export function flatta(varde: unknown, prefix = "", djup = 0): Map<string, unknown> {
  const ut = new Map<string, unknown>();
  if (djup > 8 || varde === null || varde === undefined) return ut;

  if (Array.isArray(varde)) {
    varde.forEach((v, i) => {
      for (const [k, x] of flatta(v, prefix ? `${prefix}.${i}` : String(i), djup + 1)) ut.set(k, x);
    });
    return ut;
  }

  if (typeof varde === "object") {
    for (const [k, v] of Object.entries(varde as Record<string, unknown>)) {
      const nyckel = prefix ? `${prefix}.${k.toLowerCase()}` : k.toLowerCase();
      if (v !== null && typeof v === "object") {
        for (const [kk, xx] of flatta(v, nyckel, djup + 1)) ut.set(kk, xx);
      } else {
        ut.set(nyckel, v);
      }
    }
    return ut;
  }

  if (prefix) ut.set(prefix, varde);
  return ut;
}

/**
 * Första kandidaten som finns, som exakt nyckel eller som sista led i en
 * djupare väg. Tomma strängar räknas som frånvaro — en växel som skickar
 * `"recordingUrl": ""` menar att det inte finns någon inspelning.
 *
 * `tillatSvans = false` stänger av den djupa sökningen, och det behövs för
 * nycklar som är för allmänna för att leta efter: `id` finns på allting. Se
 * `externalRef` nedan, där en träff på `user.id` hade gett alla samtal från
 * samma säljare samma sömvärde — och det unika indexet hade då låtit varje
 * nytt samtal skriva över det förra.
 */
function hamta(karta: Map<string, unknown>, kandidater: string[], tillatSvans = true): unknown {
  for (const namn of kandidater) {
    const n = namn.toLowerCase();
    if (karta.has(n)) {
      const v = karta.get(n);
      if (v !== null && v !== undefined && v !== "") return v;
    }
  }
  if (!tillatSvans) return undefined;
  for (const namn of kandidater) {
    const svans = "." + namn.toLowerCase();
    for (const [k, v] of karta) {
      if (k.endsWith(svans) && v !== null && v !== undefined && v !== "") return v;
    }
  }
  return undefined;
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/* ------------------------------------------------------------------------- *
 * Sekunder
 * ------------------------------------------------------------------------- */

/**
 * Sekunder ur det växeln råkar skicka: ett tal, `"93"`, `"00:01:33"`, `"1:33"`
 * eller ISO 8601 (`"PT1M33S"`).
 *
 * MILLISEKUNDER ÄR DEN FARLIGA FÖRVÄXLINGEN och den går inte att skilja på
 * värdet: 93000 kan vara 93 sekunder i ms eller ett samtal på ett dygn. Därför
 * gissar den här funktionen INTE. Kommer fältet från ett namn som slutar på
 * `ms` eller `millis` delas det med tusen, annars inte — och skulle en
 * felläsning ändå ske står råpåsen kvar och tolkningen går att göra om.
 */
export function sekunder(v: unknown, arMillisekunder = false): number | null {
  if (v === null || v === undefined || v === "") return null;

  if (typeof v === "number" && Number.isFinite(v)) {
    const s = arMillisekunder ? v / 1000 : v;
    return s < 0 ? null : Math.round(s);
  }

  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return sekunder(Number(s), arMillisekunder);

  // hh:mm:ss eller mm:ss
  const klocka = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (klocka) {
    const [, t, m, sek] = klocka;
    return Number(t ?? 0) * 3600 + Number(m) * 60 + Number(sek);
  }

  // ISO 8601, PT#H#M#S
  const iso = s.match(/^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso) {
    const [, t, m, sek] = iso;
    const total = Number(t ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(sek ?? 0);
    return Math.round(total);
  }

  return null;
}

/**
 * En tidpunkt som ISO-sträng, ur epoksekunder, epokmillisekunder eller text.
 *
 * Gränsen mellan sekunder och millisekunder går vid 1e11 — det är år 5138 i
 * sekunder och år 1973 i millisekunder, alltså långt utanför båda hållens
 * rimliga värden.
 */
export function tidpunkt(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;

  const tal = typeof v === "number" ? v : /^\d{9,}$/.test(String(v).trim()) ? Number(v) : null;
  if (tal !== null && Number.isFinite(tal)) {
    const ms = tal < 1e11 ? tal * 1000 : tal;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Längden ur klockslagen, när växeln inte skickar någon.
 *
 * Lynes gör inte det: påsen bär `startTime` och `endTime` men inget
 * `duration`. Subtraktionen är inte riktigt samma sak — den mäter hela
 * uppkopplingen, inklusive signaltiden — men det är den uppgiften som finns,
 * och `talk_seconds` bär den del då någon faktiskt talade.
 */
function langdAvFonstret(start: string | null, slut: string | null): number | null {
  if (!start || !slut) return null;
  const ms = Date.parse(slut) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 1000);
}

/**
 * Taltiden, med samtalets längd som skiljedomare.
 *
 * ===========================================================================
 * VARFÖR DEN HÄR FUNKTIONEN INTE BARA DIVIDERAR MED TUSEN
 *
 * Lynes skickar `talkTime` i millisekunder utan att namnet säger det. Den
 * enkla rättelsen vore att lägga `talktime` bland de ms-namn `sekunder()`
 * räknar om — och den vore fel på ett sätt som inte syns: den dagen en påse
 * bär sekunder blir varje samtal tusen gånger för kort, och en taltid på noll
 * ser ut som ett samtal ingen sa något på.
 *
 * Men vi behöver inte gissa. Samtalets längd är känd ur klockslagen, och
 * TALTIDEN KAN INTE VARA LÄNGRE ÄN SAMTALET. Det gör längden till ett facit:
 *
 *   407000 mot ett samtal på 407 s  → som sekunder omöjligt, som ms exakt rätt
 *   71     mot ett samtal på 93 s   → som sekunder rimligt, rör det inte
 *
 * Slutsatsen dras alltså per rad, ur radens egna uppgifter, och håller oavsett
 * vad växeln gör härnäst.
 *
 * `somMs > 0` är inte en petitess: ett värde på 300 mot ett samtal på 30 s är
 * orimligt som sekunder OCH blir noll som millisekunder. Då har vi läst fel
 * fält, och noll vore ett påstående vi inte har täckning för. Null är svaret.
 */
export function taltid(
  varde: unknown,
  namnetSagerMs: boolean,
  langd: number | null,
): number | null {
  if (varde === undefined || varde === null || varde === "") return null;
  if (namnetSagerMs) return sekunder(varde, true);

  const somSekunder = sekunder(varde);
  if (somSekunder === null) return null;

  // Ingen längd att jämföra med — då står det som står. Lynes skickar alltid
  // båda klockslagen, så det här är fallet "någon annan växel, någon gång".
  if (langd === null) return somSekunder;

  if (somSekunder <= langd) return somSekunder;

  const somMs = sekunder(varde, true);
  if (somMs !== null && somMs > 0 && somMs <= langd) return somMs;

  return null;
}

/* ------------------------------------------------------------------------- *
 * Telefonnummer
 * ------------------------------------------------------------------------- */

/**
 * Svenskt nummer till E.164, eller null när det inte går att säga.
 *
 * NULL ÄR ETT VIKTIGARE SVAR ÄN DET SER UT. Numret är det enda vi har att para
 * ihop ett samtal med en order på, och en anknytning (`1042`) eller ett
 * dolt nummer (`anonymous`) som råkade bli `+461042` hade kunnat matcha fel
 * kund. Råvärdet sparas alltid i `counterpart_raw` vid sidan av.
 */
export function normaliseraNummer(raw: unknown): string | null {
  const s = text(raw);
  if (s === null) return null;

  const rensat = s.replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(rensat)) return null;

  let siffror = rensat;
  if (siffror.startsWith("+")) siffror = siffror.slice(1);
  else if (siffror.startsWith("00")) siffror = siffror.slice(2);
  else if (siffror.startsWith("0")) siffror = "46" + siffror.slice(1);
  else if (siffror.length <= 6) return null; // anknytning, inte ett nummer
  // Kvar: siffror utan prefix och längre än sex — tolkas som redan landskodat.

  if (siffror.length < 8 || siffror.length > 15) return null;
  return "+" + siffror;
}

/* ------------------------------------------------------------------------- *
 * Riktning och utfall
 * ------------------------------------------------------------------------- */

const RIKTNING: Record<string, Riktning> = {
  in: "in",
  inbound: "in",
  incoming: "in",
  // Lynes riktiga värde, avläst 2026-09-11. `slaUpp` skalar dessutom bort
  // ändelsen `_call`, så `INCOMING_CALL` hade träffat `incoming` även utan den
  // här raden — båda står med för att raden ska gå att hitta när någon söker
  // på det värde som faktiskt står i `raw_call_type`.
  incoming_call: "in",
  inkommande: "in",
  received: "in",
  ut: "ut",
  outbound: "ut",
  outgoing: "ut",
  outgoing_call: "ut",
  utgaende: "ut",
  utgående: "ut",
  dialed: "ut",
  placed: "ut",
};

const UTFALL: Record<string, Utfall> = {
  answered: "besvarat",
  answer: "besvarat",
  completed: "besvarat",
  besvarat: "besvarat",
  missed: "missat",
  noanswer: "missat",
  "no-answer": "missat",
  missat: "missat",
  bounced: "studsat",
  busy: "studsat",
  rejected: "studsat",
  failed: "studsat",
  studsat: "studsat",
  voicemail: "rostbrevlada",
  voice_mail: "rostbrevlada",
  mailbox: "rostbrevlada",
  rostbrevlada: "rostbrevlada",
  routed: "kopplat",
  forwarded: "kopplat",
  transferred: "kopplat",
  kopplat: "kopplat",
};

function slaUpp<T>(karta: Record<string, T>, raw: string | null, standard: T): T {
  if (raw === null) return standard;
  const n = raw.trim().toLowerCase().replace(/\s+/g, "");
  return (
    karta[n] ??
    karta[n.replace(/[_-]/g, "")] ??
    // `OUTGOING_CALL` → `outgoing`. Ändelsen säger bara att det är ett samtal,
    // vilket vi redan vet. Att skala bort den gör att en framtida variant
    // (`MISSED_CALL`, `INTERNAL_CALL`) har en chans att träffa i stället för
    // att bli `okand` bara för suffixets skull.
    karta[n.replace(/_?calls?$/, "")] ??
    standard
  );
}

/* ------------------------------------------------------------------------- *
 * Tolkningen
 * ------------------------------------------------------------------------- */

export function tolkaSamtal(payload: unknown): Tolkning {
  const k = flatta(payload);

  const rawCallType = text(hamta(k, ["calltype", "call_type", "direction", "type"]));
  const rawItemType = text(hamta(k, ["itemtype", "item_type", "result", "status", "disposition", "outcome"]));

  const direction = slaUpp(RIKTNING, rawCallType, "okand");
  // `itemType` bär inte riktningen, men `callType` gjorde det före v2. Står
  // riktningen kvar som `okand` får utfallsfältet försöka — annars tappar vi
  // riktningen på just de äldre posterna.
  const riktning = direction === "okand" ? slaUpp(RIKTNING, rawItemType, "okand") : direction;

  const outcome = slaUpp(UTFALL, rawItemType, slaUpp(UTFALL, rawCallType, "okant"));

  // Vem som ringde. TVÅ SAKER ATT VETA OM DEN HÄR LISTAN:
  //
  // 1. E-POSTEN FÖRST, ID:T SIST. `slaUppPerson()` matchar en e-postadress mot
  //    `employee.email` och kopplar samtalet direkt. Ett internt id hos Lynes
  //    kopplar ingenting förrän någon lagt en rad i `phone_identity` för hand.
  //    Plockas id:t för att det råkade stå först blir varje samtal okopplat,
  //    och det syns bara som att statistiken är tom.
  //
  // 2. NYCKLARNA ÄR PUNKTADE. `user.email` är en nyckel i den utplattade
  //    kartan, inte två. Ett `useremail` utan punkt träffar `{"userEmail":...}`
  //    men INTE `{"user":{"email":...}}` — och den nästlade formen är den en
  //    växel oftast skickar. Båda står därför med.
  // `recorderId` FÖRST. Det är Lynes fält för e-postadressen, avläst ur riktig
  // trafik 2026-09-11 — och e-posten är det enda som matchar `employee.email`
  // och kopplar samtalet till en person på egen hand. `userId` finns i samma
  // påse men är en uuid: den kopplar ingenting förrän någon lagt en rad i
  // `phone_identity` för hand. Låg `userId` först blev varje samtal okopplat,
  // vilket är exakt vad som hände med de sexton första.
  const agentRef = text(
    hamta(k, [
      "recorderid", "recorder_id", "recorder.email",
      "useremail", "user_email", "user.email", "agentemail", "agent_email",
      "agent.email", "owner.email", "answeredby.email",
      "extension", "anknytning", "user.extension", "agent.extension",
      "agent", "owner", "answeredby", "answered_by", "handledby",
      "agentid", "agent_id", "agent.id", "userid", "user_id", "user.id", "user",
    ]),
  );

  // Motparten. Är riktningen känd tas den från rätt håll; annars faller vi
  // tillbaka på ett generellt namn. Ett fel här ger fel nummer, inte ett
  // saknat — därför står råvärdet alltid kvar vid sidan av.
  const motpartRaw =
    riktning === "in"
      ? text(hamta(k, ["callernumber", "caller_number", "from", "fromnumber", "from_number", "caller", "anumber", "a_number", "source"]))
      : riktning === "ut"
        ? text(hamta(k, ["calleenumber", "callee_number", "to", "tonumber", "to_number", "callee", "destination", "bnumber", "b_number", "target"]))
        : text(hamta(k, ["counterpart", "customernumber", "customer_number", "number", "msisdn", "phone"]));

  const motpart = motpartRaw ?? text(hamta(k, ["counterpart", "number", "msisdn", "phone"]));

  const startedAt = tidpunkt(hamta(k, ["starttime", "start_time", "startedat", "started_at", "start", "calltime", "timestamp", "createdat", "created_at"]));
  const endedAt = tidpunkt(hamta(k, ["endtime", "end_time", "endedat", "ended_at", "end", "hangupat", "hangup_at", "stoptime"]));

  // Millisekunder bara när fältnamnet säger det. Se `sekunder()`.
  const langdMs = hamta(k, ["durationms", "duration_ms", "durationmillis", "calldurationms"]);
  const angivenLangd =
    langdMs !== undefined
      ? sekunder(langdMs, true)
      : sekunder(hamta(k, ["duration", "durationseconds", "duration_seconds", "callduration", "call_duration", "length", "totalduration", "samtalslangd"]));

  // LYNES SKICKAR INGEN LÄNGD ALLS. Den räknas fram ur klockslagen, som båda
  // finns i varje påse. Ett angivet fält går före: står det där är det växelns
  // eget svar, och vår subtraktion är bara en uppskattning av samma sak.
  const durationSeconds = angivenLangd ?? langdAvFonstret(startedAt, endedAt);

  // TALTIDEN ÄR MILLISEKUNDER HOS LYNES, utan att namnet säger det: `talkTime`
  // stod på 407000 i en påse där `endTime - startTime` var 407000 ms, alltså
  // 407 sekunder. Lästes den som sekunder blev samtalet fyra dygn långt — och
  // eftersom ingen längd fanns att jämföra med fanns inget villkor som
  // avvisade det. Tabellen hann få en taltid på trettio dygn innan det syntes.
  //
  // `taltid()` avgör saken per rad med längden som facit, i stället för att
  // hårdkoda vilken enhet det är. Se resonemanget där.
  const taltidNamngivenMs = hamta(k, ["talktimems", "talk_time_ms", "talkdurationms"]);
  const taltidVarde =
    taltidNamngivenMs ??
    hamta(k, ["talktime", "talk_time", "talkduration", "talk_duration", "billsec", "answeredduration", "taltid"]);
  const talkSeconds = taltid(taltidVarde, taltidNamngivenMs !== undefined, durationSeconds);

  // `fileUrls` är en ARRAY, alltså `fileurls.0` i den utplattade kartan.
  //
  // OBS ATT ADRESSEN ÄR FÄRSKVARA. Lynes lämnar en förhandssignerad S3-adress
  // med `X-Amz-Expires=1800` — den slutar gälla efter en halvtimme. Den sparas
  // för att den säger att en inspelning FINNS och var den låg, inte för att
  // den går att öppna i efterhand. Se `docs/NASTA_SESSION.md`.
  const recordingUrl = text(
    hamta(k, [
      "fileurls.0", "fileurl", "fileurls",
      "recordingurl", "recording_url", "recording", "recordinglink",
      "recordingfileurl", "audiourl", "audio_url", "mediaurl", "media_url",
      "inspelning", "inspelningsurl",
    ]),
  );

  // Söms-värdet. De distinkta namnen får sökas på djupet, `id` bara som egen
  // nyckel högst upp — se `hamta()`.
  const externalRef =
    text(hamta(k, ["callid", "call_id", "sessionid", "session_id", "externalid", "external_id", "uuid", "reference"])) ??
    text(hamta(k, ["id"], false));

  return {
    externalRef,
    direction: riktning,
    outcome,
    rawCallType,
    rawItemType,
    agentRef,
    counterpartRaw: motpart,
    counterpartE164: normaliseraNummer(motpart),
    startedAt,
    endedAt,
    durationSeconds,
    talkSeconds:
      // Taltiden kan inte vara längre än samtalet. Är den det har vi läst fel
      // fält, och då är det ärligare att inte påstå något än att skriva in ett
      // värde som villkoret i 0052 ändå hade avvisat.
      talkSeconds !== null && durationSeconds !== null && talkSeconds > durationSeconds
        ? null
        : talkSeconds,
    recordingUrl: recordingUrl && /^https?:\/\//i.test(recordingUrl) ? recordingUrl : null,
  };
}

/**
 * Vad `recording_state` ska stå på när samtalet just kommit in.
 *
 * `hos_vaxeln` betyder "det finns ljud, vi har det inte". Nedladdningen (steg
 * 2) hämtar bara de samtal som dessutom fått en order — se villkoret
 * `phone_call_inspelning` i 0052.
 */
export function inspelningslage(t: Tolkning): "ingen" | "hos_vaxeln" {
  return t.recordingUrl ? "hos_vaxeln" : "ingen";
}
