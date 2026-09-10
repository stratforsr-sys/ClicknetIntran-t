/**
 * Tolkningen av vad växeln skickar. Ren logik, inga importer.
 *
 * ===========================================================================
 * VARFÖR DEN HÄR FILEN LETAR I STÄLLET FÖR ATT LÄSA
 *
 * Lynes payloadformat är inte publikt dokumenterat — det ligger i deras app
 * under Profil → API-dokumentation, och den anpassade webhooken slås dessutom
 * på av deras support. Det vi vet från släppnoterna är att `callType` och
 * `itemType` finns, och att `itemType` skiljer besvarat, missat, studsat,
 * röstbrevlåda och kopplat.
 *
 * Att skriva `payload.duration` på den grunden vore att gissa en gång och sedan
 * aldrig få veta om gissningen var fel: fältet blir bara `undefined`, samtalet
 * får ingen längd, och ingenting ser trasigt ut. Därför plattas påsen ut till
 * en karta av gena nycklar och varje uppgift söks på en LISTA av rimliga namn,
 * oavsett hur djupt den ligger. `duration`, `durationSeconds`, `callDuration`
 * och `data.call.duration` hamnar alla rätt.
 *
 * Och `call_ingest` behåller råpåsen. Visar det sig att växeln kallar taltiden
 * något vi inte gissat går tolkningen att göra om — utan att någon uppgift
 * behövt vara sparad två gånger.
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
  inkommande: "in",
  received: "in",
  ut: "ut",
  outbound: "ut",
  outgoing: "ut",
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
  return karta[n] ?? karta[n.replace(/[_-]/g, "")] ?? standard;
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
  const agentRef = text(
    hamta(k, [
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
      ? text(hamta(k, ["from", "fromnumber", "from_number", "caller", "callernumber", "anumber", "a_number", "source"]))
      : riktning === "ut"
        ? text(hamta(k, ["to", "tonumber", "to_number", "callee", "destination", "bnumber", "b_number", "target"]))
        : text(hamta(k, ["counterpart", "customernumber", "customer_number", "number", "msisdn", "phone"]));

  const motpart = motpartRaw ?? text(hamta(k, ["counterpart", "number", "msisdn", "phone"]));

  // Millisekunder bara när fältnamnet säger det. Se `sekunder()`.
  const langdNyckel = ["durationms", "duration_ms", "durationmillis", "calldurationms"];
  const langdMs = hamta(k, langdNyckel);
  const durationSeconds =
    langdMs !== undefined
      ? sekunder(langdMs, true)
      : sekunder(hamta(k, ["duration", "durationseconds", "duration_seconds", "callduration", "call_duration", "length", "totalduration", "samtalslangd"]));

  const taltidMs = hamta(k, ["talktimems", "talk_time_ms", "talkdurationms"]);
  const talkSeconds =
    taltidMs !== undefined
      ? sekunder(taltidMs, true)
      : sekunder(hamta(k, ["talktime", "talk_time", "talkduration", "talk_duration", "billsec", "answeredduration", "taltid"]));

  const startedAt = tidpunkt(hamta(k, ["starttime", "start_time", "startedat", "started_at", "start", "calltime", "timestamp", "createdat", "created_at"]));
  const endedAt = tidpunkt(hamta(k, ["endtime", "end_time", "endedat", "ended_at", "end", "hangupat", "hangup_at", "stoptime"]));

  const recordingUrl = text(
    hamta(k, [
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
