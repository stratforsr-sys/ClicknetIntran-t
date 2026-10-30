/**
 * S09 · GDPR (2026-10-23): nattjobbets gallring.
 *
 * Fem saker ska inte sparas langre an de behovs (art. 5.1 e):
 *
 *   kandidater  Ej anstallda kandidater: gallringsdagen (`gdpr_purge_at`, satt
 *               av 0030:s utlosare vid avslag, 12 manader enligt 0110:231-239),
 *               en oppen process utan handelse pa 12 manader, och talangpoolen
 *               24 manader efter samtycket (B5). En anstalld kandidat gallras
 *               inte medan personen finns kvar: raden hor till anstallningen.
 *               Ar personen borttagen (`hired_employee_id` ar "on delete set
 *               null", eller personalposten har `removed_at`) galler fristen.
 *   cv          CV-filerna for de kandidaterna. `candidate.cv_file_id` kan i dag
 *               aldrig fyllas (C16), sa antalet ar 0 tills ett CV-andamal finns.
 *   palett      Palettens fragor utan svar (0125), 90 dagar efter dagen de
 *               senast stalldes (B5).
 *   moten       Motesbolag (A11, Moten): 24 manader efter bolagets senaste
 *               handelse, om ingen av dess kedjor slutade i en affar. Kedjor och
 *               moten foljer med i kaskaden. Ett bolag med affar sparas: orderns
 *               egna regler galler da.
 *   filer       Filer i lagringen (Supabase och R2) som ingen rad pekar pa:
 *               lakarintyg efter raderade sjukanmalningar, arendebilagor efter
 *               borttagna personer, uppladdningar som aldrig registrerades.
 *               Bara prefix som navet sjalvt skriver (FILPREFIX och arenden/),
 *               och bara filer aldre an ett dygn.
 *
 * GALLRA AR AV. Steget raknar varje natt och skriver antalen i nattjobbets
 * kvitto, men raderar ingenting forran bestallaren sett antalen och sagt ja
 * (B6). Paslaget ar en egen commit: `GALLRA = true`.
 *
 * Reglerna ar rena funktioner overst, provade i `tests/nav2-gallring.mjs`.
 * Databasen och lagringen lases in forst i `gallra()`, sa att provet kan
 * importera filen utan Next.
 */
import { maskeraPersonnummer } from "../leads.ts";

/** Bestallarens ja kravs (B6). Slas pa i en egen commit, aldrig tillsammans med annat. */
export const GALLRA = false;

/** B5 (2026-10-22): palettens obesvarade fragor sparas i 90 dagar. */
export const PALETT_DAGAR = 90;
/** B5: talangpoolen sparas i 24 manader, raknat fran samtycket. */
export const TALANGPOOL_MANADER = 24;
/** A11: ett motesbolag sparas i 24 manader, raknat fran bolagets senaste handelse. */
export const MOTESBOLAG_MANADER = 24;
/** En fil yngre an sa har kan vara en uppladdning som inte hunnit registreras. */
export const FIL_MOGEN_TIMMAR = 24;

/** Prefixen navet skriver i lagringen: `bygStig(andamal, id)` och arendenas bilagor. */
export const FILPREFIX = [
  "call_recording",
  "employment_contract",
  "sales_order",
  "roleplay",
  "coaching",
  "sick_certificate",
  "document_attachment",
  "arenden",
] as const;

const DAG = 86_400_000;

/**
 * Navets regel for personnummer (K27, samma uttryck som `ser_ut_som_personnummer()`
 * i 0030). Palettens fragor och Rutiners sokningar gar igenom den fore sparning.
 */
export function maskera(text: string): string {
  return maskeraPersonnummer(text);
}

/** Dagen i Sverige, YYYY-MM-DD. */
export function svenskDag(nu: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(nu);
}

function plusDagar(dag: string, dagar: number): string {
  return new Date(Date.parse(`${dag}T12:00:00Z`) + dagar * DAG).toISOString().slice(0, 10);
}

/** Den aldsta dag en fraga far ha stallts for att sparas (och visas i Adoption). */
export function palettGrans(nu: Date, dagar = PALETT_DAGAR): string {
  return plusDagar(svenskDag(nu), -dagar);
}

export type Palettrad = { q: string; week: string; dag: string | null };

/**
 * Fragorna som ska bort: senast stalld fore `dagar` dagar sedan. En rad fran
 * utan `dag` (fanns inte fore 0223) raknas fran veckans sista dag.
 */
export function palettAttRadera(rader: Palettrad[], nu: Date, dagar = PALETT_DAGAR): { q: string; week: string }[] {
  const grans = palettGrans(nu, dagar);
  return rader
    .filter((r) => (r.dag ?? plusDagar(String(r.week).slice(0, 10), 6)) < grans)
    .map((r) => ({ q: r.q, week: String(r.week).slice(0, 10) }));
}

export type Kandidatrad = {
  id: string;
  stage: string;
  hired_employee_id: string | null;
  talent_pool: boolean;
  talent_pool_consent: string | null;
  gdpr_purge_at: string | null;
  /** Senaste handelsen: steg, anteckning, meddelande, ansokan eller avslut. */
  senaste: string | null;
  cv_file_id: string | null;
};

function plusManader(tid: string, manader: number): number {
  const d = new Date(tid);
  d.setUTCMonth(d.getUTCMonth() + manader);
  return d.getTime();
}

/**
 * Kandidaterna som ska gallras. `fristDagar` ar `recruitment_policy.purge_after_days`;
 * ar den inte satt gallras ingen utanfor talangpoolen (0030: "utan varde raderas inget").
 */
export function kandidaterAttRadera(
  rader: Kandidatrad[],
  nu: Date,
  {
    fristDagar,
    poolManader = TALANGPOOL_MANADER,
    aktivaAnstallda,
  }: {
    fristDagar: number | null;
    poolManader?: number;
    /** Anstallda som finns kvar (removed_at is null). Utelamnad: varje hired_employee_id skyddar. */
    aktivaAnstallda?: Set<string>;
  },
): string[] {
  const t = nu.getTime();
  const ut: string[] = [];
  for (const r of rader) {
    if (r.hired_employee_id && (!aktivaAnstallda || aktivaAnstallda.has(r.hired_employee_id))) continue;
    if (r.talent_pool) {
      const fran = r.talent_pool_consent ?? r.senaste;
      if (fran && plusManader(fran, poolManader) < t) ut.push(r.id);
      continue;
    }
    if (fristDagar == null) continue;
    if (r.gdpr_purge_at) {
      if (Date.parse(r.gdpr_purge_at) < t) ut.push(r.id);
      continue;
    }
    if (r.senaste && Date.parse(r.senaste) + fristDagar * DAG < t) ut.push(r.id);
  }
  return ut;
}

export type Motesbolagsrad = {
  id: string;
  /** `mote_bolag.senast_handelse` (timestamptz, satt av trigger). */
  senast_handelse: string;
  /** Bolaget har en kedja med avslut = 'affar': orderns regler galler da. */
  affar: boolean;
};

/**
 * Motesbolagen som ska gallras: senaste handelsen for mer an `manader` sedan
 * (samma raknesatt som talangpoolen: strikt aldre, exakt pa gransen sparas) och
 * ingen affar. En tidsstampel som inte gar att tolka raderar aldrig.
 */
export function motesbolagAttRadera(rader: Motesbolagsrad[], nu: Date, manader = MOTESBOLAG_MANADER): string[] {
  const t = nu.getTime();
  return rader.filter((r) => !r.affar && plusManader(r.senast_handelse, manader) < t).map((r) => r.id);
}

export type Lagringsobjekt = { lager: "supabase" | "r2"; bucket: string; path: string; andrad: string | null };

export const lagringsnyckel = (lager: string, bucket: string, path: string) => `${lager}|${bucket}|${path}`;

/** Filerna i lagringen som ingen rad pekar pa, i navets egna prefix och aldre an ett dygn. */
export function foraldralosa(
  objekt: Lagringsobjekt[],
  kanda: Set<string>,
  nu: Date,
  mogenTimmar = FIL_MOGEN_TIMMAR,
): Lagringsobjekt[] {
  const mogen = nu.getTime() - mogenTimmar * 3_600_000;
  return objekt.filter(
    (o) =>
      (FILPREFIX as readonly string[]).includes(o.path.split("/")[0]) &&
      !o.path.endsWith("/.emptyFolderPlaceholder") &&
      o.andrad != null &&
      Date.parse(o.andrad) < mogen &&
      !kanda.has(lagringsnyckel(o.lager, o.bucket, o.path)),
  );
}

export type Gallringskvitto = {
  kandidater: number;
  cv: number;
  palett: number;
  filer: number;
  motesbolag: number;
  /** Sant bara nar GALLRA ar pa och anroparen bad om det. Annars ar antalen det som SKULLE ha raderats. */
  raderade: boolean;
  fel: string[];
};

/**
 * Raknar, och raderar nar `kor` och GALLRA bada ar sanna. Kastar bara om
 * databasen inte gar att lasa alls; ett fel pa en enskild fil hamnar i `fel`.
 */
export async function gallra(nu: Date, { kor }: { kor: boolean }): Promise<Gallringskvitto> {
  const { supabaseAdmin } = await import("@/lib/supabase/server");
  const { delaUpp, lasSidvis } = await import("@/lib/sidvis");
  const { bucketen, listaObjekt, taBort } = await import("@/lib/lagring-server");
  const { tolkaLager } = await import("@/lib/lagring");
  const db = supabaseAdmin();
  const radera = kor && GALLRA;
  const fel: string[] = [];

  // ---- Kandidaterna --------------------------------------------------------
  const { data: policy } = await db.from("recruitment_policy").select("purge_after_days").maybeSingle();
  const kandidater = await lasSidvis<Record<string, unknown>>((fran, till) =>
    db
      .from("candidate")
      .select("id, stage, hired_employee_id, talent_pool, talent_pool_consent, gdpr_purge_at, closed_at, stage_at, applied_at, created_at, cv_file_id")
      .order("id")
      .range(fran, till),
  );
  const senast = new Map<string, number>();
  const notera = (id: unknown, tid: unknown) => {
    const t = tid ? Date.parse(String(tid)) : NaN;
    if (id && !Number.isNaN(t)) senast.set(String(id), Math.max(senast.get(String(id)) ?? 0, t));
  };
  for (const k of kandidater) for (const f of ["closed_at", "stage_at", "applied_at", "created_at"]) notera(k.id, k[f]);
  for (const [tabell, falt] of [["candidate_stage_event", "at"], ["candidate_note", "at"], ["candidate_message", "created_at"]] as const) {
    const rader = await lasSidvis<Record<string, unknown>>((fran, till) =>
      db.from(tabell).select(`id, candidate_id, ${falt}`).order("id").range(fran, till),
    );
    for (const r of rader) notera(r.candidate_id, r[falt]);
  }
  const kandidatrader: Kandidatrad[] = kandidater.map((k) => ({
    id: String(k.id),
    stage: String(k.stage ?? ""),
    hired_employee_id: (k.hired_employee_id as string | null) ?? null,
    talent_pool: k.talent_pool === true,
    talent_pool_consent: (k.talent_pool_consent as string | null) ?? null,
    gdpr_purge_at: (k.gdpr_purge_at as string | null) ?? null,
    senaste: senast.has(String(k.id)) ? new Date(senast.get(String(k.id))!).toISOString() : null,
    cv_file_id: (k.cv_file_id as string | null) ?? null,
  }));
  const fristDagar = policy?.purge_after_days ? Number(policy.purge_after_days) : null;
  const anstallda = await lasSidvis<Record<string, unknown>>((fran, till) =>
    db.from("employee").select("id").is("removed_at", null).order("id").range(fran, till),
  );
  const aktivaAnstallda = new Set(anstallda.map((e) => String(e.id)));
  const bortKandidater = kandidaterAttRadera(kandidatrader, nu, { fristDagar, aktivaAnstallda });
  const cvIds = kandidatrader.filter((k) => bortKandidater.includes(k.id) && k.cv_file_id).map((k) => k.cv_file_id!);

  // ---- Palettens fragor ----------------------------------------------------
  const palettrader = await lasSidvis<Record<string, unknown>>((fran, till) =>
    db.from("nav_question_miss").select("q, week, dag").order("week").order("q").range(fran, till),
  );
  const bortPalett = palettAttRadera(
    palettrader.map((r) => ({
      q: String(r.q),
      week: String(r.week),
      dag: r.dag ? String(r.dag).slice(0, 10) : null,
    })),
    nu,
  );

  // ---- Motesbolag (A11) ----------------------------------------------------
  // Bara bolag vars senaste handelse ar aldre an gransen lases, med en uttrycklig
  // begransning: motesbolagAttRadera avgor sedan pa riktigt.
  const motesgrans = new Date(nu);
  motesgrans.setUTCMonth(motesgrans.getUTCMonth() - MOTESBOLAG_MANADER);
  const motesbolag = await lasSidvis<Record<string, unknown>>((fran, till) =>
    db.from("mote_bolag").select("id, senast_handelse").lt("senast_handelse", motesgrans.toISOString()).order("id").range(fran, till),
  );
  const affarsbolag = new Set<string>();
  const AFFARSGRANS = 1000; // Supabase kapar tyst vid 1000 rader: ett fullt svar ar aldrig ett helt svar
  for (const omgang of delaUpp(motesbolag.map((b) => String(b.id)), 100)) {
    const { data, error } = await db.from("mote_kedja").select("bolag_id").eq("avslut", "affar").in("bolag_id", omgang).limit(AFFARSGRANS);
    if (error || (data ?? []).length >= AFFARSGRANS) {
      // Gick det inte att se vilka som har en affar, eller kapades svaret,
      // raderas inget av dem.
      fel.push(`motesbolag: ${error?.message ?? "for manga affarskedjor i en omgang"}`);
      for (const id of omgang) affarsbolag.add(id);
      continue;
    }
    for (const k of data ?? []) affarsbolag.add(String(k.bolag_id));
  }
  const bortMotesbolag = motesbolagAttRadera(
    motesbolag.map((b) => ({ id: String(b.id), senast_handelse: String(b.senast_handelse), affar: affarsbolag.has(String(b.id)) })),
    nu,
  );

  // ---- Filerna i lagringen -------------------------------------------------
  const kanda = new Set<string>();
  const filrader = await lasSidvis<Record<string, unknown>>((fran, till) =>
    db.from("file_object").select("id, store, bucket, path").is("removed_at", null).order("id").range(fran, till),
  );
  for (const f of filrader) kanda.add(lagringsnyckel(tolkaLager(f.store), String(f.bucket), String(f.path)));
  const bilagor = await lasSidvis<Record<string, unknown>>((fran, till) =>
    db.from("hr_case_attachment").select("id, store, bucket, path").order("id").range(fran, till),
  );
  for (const f of bilagor) kanda.add(lagringsnyckel(tolkaLager(f.store), String(f.bucket), String(f.path)));
  // En CV-fil som gallras med sin kandidat raknas under cv, inte som foraldralos.
  const objekt: Lagringsobjekt[] = [];
  for (const lager of ["supabase", "r2"] as const) {
    let bucket: string;
    try {
      bucket = bucketen(lager);
    } catch {
      continue; // R2 inte uppsatt: inget att lista
    }
    for (const prefix of FILPREFIX) {
      const l = await listaObjekt({ lager, bucket, prefix });
      if ("fel" in l) {
        fel.push(`${lager}/${prefix}: ${l.fel}`);
        continue;
      }
      objekt.push(...l.objekt.map((o) => ({ lager, bucket, path: o.path, andrad: o.andrad })));
    }
  }
  // Gick listningen inte att lita pa raderas inga filer, men antalet visas.
  const bortFiler = foraldralosa(objekt, kanda, nu);

  if (radera) {
    for (const id of cvIds) {
      const { data: f } = await db.from("file_object").select("store, bucket, path").eq("id", id).is("removed_at", null).maybeSingle();
      if (f) {
        const s = await taBort({ lager: tolkaLager(f.store), bucket: f.bucket, path: f.path });
        if (!s.ok) fel.push(`cv ${id}: ${s.fel}`);
        // Raden star kvar med removed_at, som i taBortInnehall: file_object far
        // inte raderas (file_object_ar_last), och oppningsloggen ska sta kvar.
        const { error } = await db.from("file_object").update({ removed_at: nu.toISOString() }).eq("id", id);
        if (error) fel.push(`cv ${id}: ${error.message}`);
      }
    }
    for (let i = 0; i < bortKandidater.length; i += 100) {
      const { error } = await db.from("candidate").delete().in("id", bortKandidater.slice(i, i + 100));
      if (error) fel.push(`kandidater: ${error.message}`);
    }
    for (const r of bortPalett) {
      const { error } = await db.from("nav_question_miss").delete().eq("q", r.q).eq("week", r.week);
      if (error) fel.push(`palett: ${error.message}`);
    }
    for (let i = 0; i < bortMotesbolag.length; i += 100) {
      // Kaskaden tar kedjorna och motena.
      const { error } = await db
        .from("mote_bolag")
        .delete()
        .in("id", bortMotesbolag.slice(i, i + 100))
        // Fick bolaget en handelse sedan det lastes raderas det inte.
        .lt("senast_handelse", motesgrans.toISOString());
      if (error) fel.push(`motesbolag: ${error.message}`);
    }
    if (!fel.some((f) => /^(supabase|r2)\//.test(f))) {
      // Kontrollen gors om direkt fore borttagningen: listan ovan lastes sidvis
      // och en rad som andrades under tiden kan ha hoppats over. En fil med en
      // rad, aven en borttagen rad i file_object, rors inte har.
      const harRad = new Set<string>();
      for (const omgang of delaUpp(bortFiler.map((o) => o.path), 100)) {
        for (const tabell of ["file_object", "hr_case_attachment"] as const) {
          const { data, error } = await db.from(tabell).select("store, bucket, path").in("path", omgang);
          if (error) {
            fel.push(`kontroll ${tabell}: ${error.message}`);
            for (const p of omgang) harRad.add(p);
            continue;
          }
          for (const r of data ?? []) harRad.add(String(r.path));
        }
      }
      for (const o of bortFiler.filter((x) => !harRad.has(x.path))) {
        const s = await taBort({ lager: o.lager, bucket: o.bucket, path: o.path });
        if (!s.ok) fel.push(`fil ${o.path}: ${s.fel}`);
      }
    }
    // Antal, aldrig namn: loggen ska inte bli en lista over de gallrade.
    await db.from("audit_log").insert({
      actor_id: null,
      action: "gdpr.gallring",
      object_type: "gallring",
      object_id: svenskDag(nu),
      meta: { kandidater: bortKandidater.length, cv: cvIds.length, palett: bortPalett.length, filer: bortFiler.length, motesbolag: bortMotesbolag.length, fel: fel.length },
    });
  }

  return { kandidater: bortKandidater.length, cv: cvIds.length, palett: bortPalett.length, filer: bortFiler.length, motesbolag: bortMotesbolag.length, raderade: radera, fel };
}
