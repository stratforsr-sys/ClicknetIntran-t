/**
 * Möten: reglerna för bekräftelsefönstret, pipelinekolumnen, nivån och
 * fördelningen av mötesprovision, och inställningarna med sina förval.
 *
 * Ren modul: ingen import från Supabase eller Next, så att samma regler gäller
 * i rutten, på tavlan, i jobbet och i provisionen, och kan provas utan databas
 * (tests/motesflode.mjs).
 *
 * Lägena och reglerna är fasta för alla installationer. Det som skiljer ett
 * företag från ett annat (dagar, frågor, belopp, kolumnnamn, vilka som får
 * mötesprovision, tidszon) ligger i nav_setting under "moten.*". Inget här är
 * skrivet för ett visst företag: förvalen är neutrala och beloppen noll.
 *
 * Dagar är kalenderdagar i installationens tidszon. Dagaritmetiken görs på
 * datumsträngen (mitt på dagen i UTC), aldrig på millisekunder, så att
 * sommartidsskiftet aldrig flyttar en dag.
 */

export type PipeKolumn = "bokat" | "att_bekrafta" | "bekraftat" | "hos_saljaren" | "avgjort";
export const PIPE_KOLUMNER: readonly PipeKolumn[] = ["bokat", "att_bekrafta", "bekraftat", "hos_saljaren", "avgjort"];

export type Fraga = { id: string; text: string; aktiv: boolean };
export type Satser = { kvalificerat: number; hallet: number };
export type MotenInst = {
  bekraftaDagar: number;
  fragor: Fraga[];
  satser: Satser;
  kolumnnamn: Record<PipeKolumn, string>;
  mottagare: string[];
  ombokning: "ny" | "dela";
  tidszon: string;
  utfallPaminnelse: string;
  rubrikPrefix: string;
  /** Möten före den här tiden får aldrig "väntar på bedömning", påminnelser eller låsning. Sätts av migrationen. */
  gallerFran: string | null;
};

export const INST_FORVAL: MotenInst = {
  bekraftaDagar: 2,
  fragor: [
    { id: "beslutsfattare", text: "Var rätt beslutsfattare med?", aktiv: true },
    { id: "syfte", text: "Visste kunden vad mötet gällde?", aktiv: true },
  ],
  satser: { kvalificerat: 0, hallet: 0 },
  kolumnnamn: { bokat: "Bokat", att_bekrafta: "Att bekräfta", bekraftat: "Bekräftat", hos_saljaren: "Hos säljaren", avgjort: "Avgjort" },
  mottagare: [],
  ombokning: "ny",
  tidszon: "Europe/Stockholm",
  utfallPaminnelse: "18:00",
  rubrikPrefix: "",
  gallerFran: null,
};

/** Nyckeln i nav_setting för varje inställning. */
export const INST_NYCKLAR: Record<keyof MotenInst, string> = {
  bekraftaDagar: "moten.bekrafta-dagar",
  fragor: "moten.fragor",
  satser: "moten.provision",
  kolumnnamn: "moten.kolumnnamn",
  mottagare: "moten.mottagare",
  ombokning: "moten.ombokning-provision",
  tidszon: "moten.tidszon",
  utfallPaminnelse: "moten.utfall-paminnelse",
  rubrikPrefix: "moten.rubrik-prefix",
  gallerFran: "moten.galler-fran",
};

export const GRANSER = { dagarMax: 14, fragorMax: 5, fragaText: 120, kolumnnamn: 24, prefix: 40, belopp: 100000 } as const;

const arObjekt = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function giltigTidszon(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("sv-SE", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * En tolkare per inställning: ger värdet i sin rena form, eller undefined när
 * det inte går att använda. Läsningen och sparandet (provaInstallning) går
 * genom samma tolkare, så att det som går att spara alltid går att läsa.
 */
const giltigtBelopp = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= GRANSER.belopp;
const giltigtNamn = (n: unknown): n is string => typeof n === "string" && !!n.trim() && n.trim().length <= GRANSER.kolumnnamn;

const TOLKA: { [K in Exclude<keyof MotenInst, "kolumnnamn">]: (v: unknown) => MotenInst[K] | undefined } = {
  bekraftaDagar: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= GRANSER.dagarMax ? v : undefined),
  fragor: (v) => {
    if (!Array.isArray(v) || v.length > GRANSER.fragorMax) return undefined;
    const id = new Set<string>();
    const lista: Fraga[] = [];
    for (const f of v) {
      if (!arObjekt(f) || typeof f.id !== "string" || !/^[a-z0-9_-]{1,40}$/.test(f.id) || id.has(f.id)
        || typeof f.text !== "string" || !f.text.trim() || f.text.trim().length > GRANSER.fragaText || typeof f.aktiv !== "boolean") return undefined;
      id.add(f.id);
      lista.push({ id: f.id, text: f.text.trim(), aktiv: f.aktiv });
    }
    return lista;
  },
  satser: (v) => (arObjekt(v) && giltigtBelopp(v.kvalificerat) && giltigtBelopp(v.hallet)
    ? { kvalificerat: Math.round(v.kvalificerat * 100) / 100, hallet: Math.round(v.hallet * 100) / 100 }
    : undefined),
  mottagare: (v) => (Array.isArray(v) && v.length <= 1000 && v.every((m) => typeof m === "string" && m.length > 0 && m.length <= 64) ? [...new Set(v as string[])] : undefined),
  ombokning: (v) => (v === "ny" || v === "dela" ? v : undefined),
  tidszon: (v) => (giltigTidszon(v) ? v : undefined),
  utfallPaminnelse: (v) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined),
  rubrikPrefix: (v) => (typeof v === "string" && v.trim().length <= GRANSER.prefix ? v.trim() : undefined),
  gallerFran: (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined),
};

/**
 * Varje nyckel prövas för sig: ett felaktigt värde ger förvalet för just den
 * nyckeln och välter aldrig Möten eller Provision. Kolumnnamnen prövas namn för namn.
 */
export function lasInstallningar(rader: { key: string; value: unknown }[]): MotenInst {
  const v = new Map(rader.map((r) => [r.key, r.value]));
  const ut: MotenInst = structuredClone(INST_FORVAL);
  for (const falt of Object.keys(TOLKA) as (keyof typeof TOLKA)[]) {
    if (!v.has(INST_NYCKLAR[falt])) continue;
    const t = TOLKA[falt](v.get(INST_NYCKLAR[falt]));
    if (t !== undefined) (ut as Record<string, unknown>)[falt] = t;
  }
  const namn = v.get(INST_NYCKLAR.kolumnnamn);
  if (arObjekt(namn)) for (const k of PIPE_KOLUMNER) if (giltigtNamn(namn[k])) ut.kolumnnamn[k] = (namn[k] as string).trim();
  return ut;
}

const SPARFEL: Record<keyof MotenInst, string> = {
  bekraftaDagar: "Antalet dagar ska vara ett heltal från 0 till 14.",
  fragor: "Högst fem frågor, var och en med en text på högst 120 tecken.",
  satser: "Beloppen ska vara mellan 0 och 100 000 kr.",
  kolumnnamn: "Varje kolumnnamn ska ha mellan 1 och 24 tecken.",
  mottagare: "Listan över vilka som får mötesprovision stämmer inte.",
  ombokning: "Välj Den som bokade om eller Dela lika.",
  tidszon: "Tidszonen finns inte.",
  utfallPaminnelse: "Skriv tiden som TT:MM, till exempel 18:00.",
  rubrikPrefix: "Prefixet får ha högst 40 tecken.",
  gallerFran: "Den här inställningen går inte att ändra.",
};

/** Inställningen och fältet för en nav_setting-nyckel, eller null. */
export function faltFor(nyckel: string): keyof MotenInst | null {
  const f = (Object.keys(INST_NYCKLAR) as (keyof MotenInst)[]).find((k) => INST_NYCKLAR[k] === nyckel);
  return f ?? null;
}

/**
 * Prövar ett värde innan det sparas. Samma tolkare som läsningen; kolumnnamnen
 * prövas strängare (en okänd kolumn eller ett ogiltigt namn nekas i stället för
 * att falla tillbaka). `moten.galler-fran` går inte att ändra.
 */
export function provaInstallning(nyckel: string, varde: unknown): { ok: true; varde: unknown } | { ok: false; fel: string } {
  const falt = faltFor(nyckel);
  if (!falt) return { ok: false, fel: "Okänd inställning." };
  if (falt === "gallerFran") return { ok: false, fel: SPARFEL.gallerFran };
  if (falt === "kolumnnamn") {
    if (!arObjekt(varde)) return { ok: false, fel: SPARFEL.kolumnnamn };
    const ut: Partial<Record<PipeKolumn, string>> = {};
    for (const [k, n] of Object.entries(varde)) {
      if (!(PIPE_KOLUMNER as readonly string[]).includes(k) || !giltigtNamn(n)) return { ok: false, fel: SPARFEL.kolumnnamn };
      ut[k as PipeKolumn] = n.trim();
    }
    return { ok: true, varde: ut };
  }
  const t = TOLKA[falt](varde);
  return t === undefined ? { ok: false, fel: SPARFEL[falt] } : { ok: true, varde: t };
}

/** Kalenderdagen ("YYYY-MM-DD") för en tidpunkt i tidszonen. */
export function lokalDag(tid: string | Date, tz: string): string {
  const d = typeof tid === "string" ? new Date(tid) : tid;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Lägger till n kalenderdagar till en datumsträng. */
export function plusDagar(dag: string, n: number): string {
  const [a, m, d] = dag.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

/**
 * Fönstret öppnar N dagar före mötesdagen. Senast-dagen är dagen före mötet,
 * eller mötesdagen när mötet bokades (eller flyttades) dagen före eller samma
 * dag. Senast är aldrig före öppningen (N = 0 öppnar på mötesdagen).
 */
export function bekraftelseFonster(i: { moteTid: string; senastAndrad: string; dagar: number; tz: string }): { oppnar: string; senast: string } {
  const motesdag = lokalDag(i.moteTid, i.tz);
  const dagenFore = plusDagar(motesdag, -1);
  const oppnar = plusDagar(motesdag, -Math.max(0, i.dagar));
  const bokDag = lokalDag(i.senastAndrad, i.tz);
  let senast = bokDag >= dagenFore ? motesdag : dagenFore;
  if (senast < oppnar) senast = oppnar;
  return { oppnar, senast };
}

/** Vilken kolumn ett öppet möte står i just nu. Ordningen är regeln. */
export function pipelineKolumn(
  m: { moteTid: string; langd: number; bekraftat: boolean; utfall: string | null },
  f: { oppnar: string },
  nu: Date,
  tz: string,
): PipeKolumn {
  if (m.utfall) return "avgjort";
  const slut = new Date(m.moteTid).getTime() + Math.max(0, m.langd) * 60_000;
  if (nu.getTime() >= slut) return "hos_saljaren";
  if (m.bekraftat) return "bekraftat";
  if (lokalDag(nu, tz) >= f.oppnar) return "att_bekrafta";
  return "bokat";
}

/** En kedja utan öppet möte står i Avgjort, annars avgör mötet. */
export function kortFas(
  k: { harOppetMote: boolean; mote: Parameters<typeof pipelineKolumn>[0] | null; fonster: { oppnar: string } | null },
  nu: Date,
  tz: string,
): PipeKolumn {
  if (!k.harOppetMote || !k.mote || !k.fonster) return "avgjort";
  return pipelineKolumn(k.mote, k.fonster, nu, tz);
}

/** Brådskan för ett möte som ännu ska bekräftas. Passerad senast-dag är fortfarande "i dag". */
export function bradska(senast: string, kolumn: PipeKolumn, nu: Date, tz: string): "idag" | "imorgon" | null {
  if (kolumn !== "bokat" && kolumn !== "att_bekrafta") return null;
  const idag = lokalDag(nu, tz);
  if (idag >= senast) return "idag";
  if (plusDagar(idag, 1) === senast) return "imorgon";
  return null;
}

/**
 * Nivån räknas på frågorna som är aktiva när svaret ges. Alla ja ger
 * kvalificerat, ett nej ger hållet. Utan aktiva frågor är ett hållet möte
 * kvalificerat.
 */
export function niva(fragor: Fraga[], svar: { id: string; ja: boolean }[]): "kvalificerat" | "hallet" | { fel: string } {
  const per = new Map(svar.map((s) => [s.id, s.ja]));
  let allaJa = true;
  for (const f of fragor) {
    if (!f.aktiv) continue;
    const ja = per.get(f.id);
    if (typeof ja !== "boolean") return { fel: `Svar saknas: ${f.text}` };
    if (!ja) allaJa = false;
  }
  return allaJa ? "kvalificerat" : "hallet";
}

export type Andel = { employeeId: string; belopp: number; delatMed: string | null };

/**
 * Vem som får bokarprovisionen för ett möte.
 *
 * - Den som håller mötet får aldrig bokarprovision för det.
 * - Bokade säljaren (eller någon utan markering) om mötet, går den till den
 *   ursprungliga bokaren.
 * - Bokade en annan markerad bokare om det, får den hela ("ny") eller delar
 *   med den ursprungliga ("dela"). Kan den ursprungliga inte få (saknar
 *   markering eller håller mötet själv) går hela till den som bokade om.
 * - Vid delning får den ursprungliga den nedrundade halvan, den som bokade om
 *   resten, så att summan alltid är beloppet på öret.
 */
export function fordela(i: { ursprunglig: string; bokatAv: string; hallsAv: string; mottagare: readonly string[]; regel: "ny" | "dela"; belopp: number }): Andel[] {
  const mott = new Set(i.mottagare);
  const ursprungligFar = mott.has(i.ursprunglig) && i.ursprunglig !== i.hallsAv;
  const omBokare = i.bokatAv !== i.ursprunglig && i.bokatAv !== i.hallsAv && mott.has(i.bokatAv) ? i.bokatAv : null;
  if (!omBokare) return ursprungligFar ? [{ employeeId: i.ursprunglig, belopp: i.belopp, delatMed: null }] : [];
  if (i.regel === "ny" || !ursprungligFar) return [{ employeeId: omBokare, belopp: i.belopp, delatMed: null }];
  const oren = Math.round(i.belopp * 100);
  const forsta = Math.floor(oren / 2);
  return [
    { employeeId: i.ursprunglig, belopp: forsta / 100, delatMed: omBokare },
    { employeeId: omBokare, belopp: (oren - forsta) / 100, delatMed: i.ursprunglig },
  ];
}

/** Skälet som står vid ett tappat möte i Provision. */
export function taptSkal(utfall: "uteblev" | "avbokat", bekraftat: boolean): string {
  if (utfall === "avbokat") return "Avbokat";
  return bekraftat ? "Uteblev trots bekräftelse" : "Inte bekräftat före mötet";
}

/** Provisionsmånaden ("YYYY-MM-01") är mötestidens månad i tidszonen. */
export function manadFor(moteTid: string, tz: string): string {
  return `${lokalDag(moteTid, tz).slice(0, 7)}-01`;
}

/**
 * Den ursprungliga bokaren: vandra bakåt genom ombokningarna till det första
 * mötet. Ett uppföljningsmöte (också ett ombokat) ger ingen bokarprovision,
 * så vandringen ger null när den möter ett. Saknas ett föregående möte är
 * den som bokade det äldsta kända mötet den ursprungliga. En slinga ger null.
 */
export function ursprungligBokare(
  id: string,
  moten: ReadonlyMap<string, { art: string; foregaende: string | null; bokatAv: string }>,
): string | null {
  const sett = new Set<string>();
  let m = moten.get(id);
  while (m) {
    if (sett.has(id)) return null;
    sett.add(id);
    if (m.art === "uppfoljning") return null;
    if (m.art !== "ombokning" || !m.foregaende) return m.bokatAv;
    const forra = moten.get(m.foregaende);
    if (!forra) return m.bokatAv;
    id = m.foregaende;
    m = forra;
  }
  return null;
}

/** Ordningen på tavlan: kolumnvis, inom kolumnen efter tid, stigande (Avgjort fallande). */
export function sorteraFas(a: { fas: PipeKolumn; tid: string }, b: { fas: PipeKolumn; tid: string }): number {
  const k = PIPE_KOLUMNER.indexOf(a.fas) - PIPE_KOLUMNER.indexOf(b.fas);
  if (k) return k;
  return a.fas === "avgjort" ? b.tid.localeCompare(a.tid) : a.tid.localeCompare(b.tid);
}
