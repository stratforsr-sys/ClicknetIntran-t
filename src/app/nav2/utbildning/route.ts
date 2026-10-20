import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fullName, getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { dagarBakat, svensktDatum } from "@/lib/klocka";
import { notifiera } from "@/lib/notishandelse-server";
import { utgangsdatum } from "@/lib/utbildning";
import { loggaKurs } from "@/lib/utbildning-server";
import { bedomRollspel, forberedRollspel, klarModul, lamnaQuiz, registreraRollspel } from "@/app/(app)/utbildning/actions";
import { skapaUppgift } from "@/app/(app)/uppgifter/actions";
import { skapaMote } from "@/app/(app)/kalender/moten/actions";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";
import { forfallerSenast, repetitionsfragor, repText } from "@/lib/nav2/utbildning-paminnelser";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar Utbildning, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS. En läsning eller övning bockas av med `klarModul`, ett prov
 * rättas med `lamnaQuiz` (facit följer med först när provet är klarat), ett
 * rollspel lämnas in med `forberedRollspel` + `registreraRollspel` och bedöms
 * med `bedomRollspel` (återkoppling på minst tio tecken, poäng inom varje
 * kriteriums tak). Uppgifter läggs med `skapaUppgift`, och anmälan till en
 * föreläsning blir ett möte i kalendern med `skapaMote`.
 *
 * Det nya (0097): svaren i repetitionen (rättas här, inte i webbläsaren, och
 * nästa gång räknas här: fel i morgon, gissat rätt om 2 dagar, säkert rätt om
 * 7), regelboken, anteckningar och mål, lektionsbetyg, självskattning av
 * rollspel, teamets repetition, föreläsningar med frågor, insikter och
 * uppföljning, kursönskemål, egna val, och förnyelsen av ett certifikat med
 * fem frågor.
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.utbildning` på false svarar rutten 423 innan något skrivs.
 *
 * GET ?push=1 är påminnelsens text för den inloggade (0098). Enhetens service
 * worker (`public/nav2/sw.js`) frågar här först när en tom push kommer: var
 * personens senaste push i dag repetitionens (`push_sent` `utb-rep`) svarar
 * rutten med texten, annars med null, och då är det startsidans kvällsnotis.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NYCKEL = /^[a-z0-9:._-]{1,120}$/;
const FARDIGHETER = ["oppning", "behov", "invand", "avslut", "efter", "produkt", "regler"];
const MAN = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const STEG = ["dag1", "dag3", "dag7", "dag30"];

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
}
const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Stockholms klockslag och datum för en tidpunkt. */
function iStockholm(iso: string): { dag: string; min: number } {
  const delar = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const v = (t: string) => delar.find((p) => p.type === t)?.value ?? "00";
  return { dag: `${v("year")}-${v("month")}-${v("day")}`, min: Number(v("hour")) * 60 + Number(v("minute")) };
}
/** Dag och klockslag i Stockholm som tidpunkt. */
function tidpunkt(dag: string, hh: number, mm: number): string {
  const utc = Date.parse(`${dag}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  // Stockholms förskjutning den dagen: skillnaden mellan klockan där och UTC.
  const dar = iStockholm(new Date(utc).toISOString());
  const skillnad = (Date.parse(`${dar.dag}T00:00:00Z`) + dar.min * 60000) - utc;
  return new Date(utc - skillnad).toISOString();
}
/** "tor 22 okt 09:30", "22 okt 9.30" eller "2026-10-22 09:30". */
function tolkaNar(s: string, idag: string): string | null {
  const t = s.toLowerCase();
  const klocka = t.match(/(\d{1,2})[:.](\d{2})(?!.*\d[:.]\d)/);
  if (!klocka) return null;
  const hh = Number(klocka[1]), mm = Number(klocka[2]);
  if (hh > 23 || mm > 59) return null;
  let dag: string | null = null;
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) dag = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else {
    const m = t.match(/(\d{1,2})\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)/);
    if (!m) return null;
    const ar = Number(idag.slice(0, 4));
    const kand = (y: number) => `${y}-${String(MAN.indexOf(m[2]) + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
    dag = kand(ar) < idag ? kand(ar + 1) : kand(ar);
  }
  if (Number.isNaN(Date.parse(`${dag}T12:00:00Z`))) return null;
  return tidpunkt(dag, hh, mm);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (new URL(request.url).searchParams.get("push") !== "1") return svar({ fel: "Okänd läsning." }, 400);
  const mig = user.employee.id, idag = svensktDatum();
  const db = supabaseAdmin();
  const { data: senast } = await db.from("push_sent").select("kind").eq("employee_id", mig).eq("day", idag).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if ((senast as { kind: string } | null)?.kind !== "utb-rep") return svar({ rep: null });
  const fragor = await repetitionsfragor(db, [mig], new Date().toISOString());
  return svar({ rep: repText(forfallerSenast(fragor.get(mig) ?? [], idag)) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const mig = user.employee.id;
  const jagNamn = fullName(user.employee);

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b.handling ?? "");

  if (!SKRIVLAGE.utbildning) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const rls = await supabaseServer();
  const idag = svensktDatum();
  const redaktor = hasRole(user, "sales_manager", "admin", "ceo");
  const chef = hasRole(user, "sales_manager", "admin", "ceo", "team_lead");

  // Modulen och kursen som den inloggade ser dem (RLS: publicerad och i målgruppen).
  const modul = async (id: unknown) => {
    const m = String(id ?? "");
    if (!UUID.test(m)) return null;
    const { data } = await rls.from("course_module").select("id, course_id, kind, title").eq("id", m).maybeSingle();
    return data as { id: string; course_id: string; kind: string; title: string } | null;
  };
  // Facit för en fråga, och om den inloggade får se det: redaktören, den som klarat provet, eller en fråga i teamets repetition.
  const facitFor = async (qid: string) => {
    if (!UUID.test(qid)) return null;
    const { data: q } = await db.from("quiz_question").select("id, module_id, quiz_option(id, is_correct)").eq("id", qid).maybeSingle();
    if (!q) return null;
    const m = await modul(q.module_id);
    if (!m) return null;
    let far = redaktor;
    if (!far) {
      const { data: klarat } = await db.from("course_attempt").select("id").eq("employee_id", mig).eq("module_id", q.module_id).eq("passed", true).limit(1);
      far = (klarat ?? []).length > 0;
    }
    if (!far) {
      const { data: team } = await db.from("team_repetition").select("question_id").eq("question_id", qid).gte("until", idag).maybeSingle();
      far = !!team;
    }
    if (!far) return null;
    const ratt = (q.quiz_option as { id: string; is_correct: boolean }[]).find((o) => o.is_correct);
    return ratt ? { ratt: ratt.id, kurs: m.course_id, modul: m.id } : null;
  };
  const sparaBetyg = async (modulId: string, stjarnor: unknown) => {
    const n = Number(stjarnor);
    if (!Number.isInteger(n) || n < 1 || n > 5) return;
    await db.from("module_rating").upsert({ employee_id: mig, module_id: modulId, stars: n, created_at: new Date().toISOString() }, { onConflict: "employee_id,module_id" });
  };
  const klart = (ok: string) => {
    revalidatePath("/utbildning", "layout");
    return svar({ ok });
  };

  try {
    switch (handling) {
      // ---------------------------------------------------------------- Lektionerna
      case "klar": {
        // En läsning eller övning: repots klarModul (modulerna i ordning, bara läsning och övning).
        const m = await modul(b.modul);
        if (!m) return svar({ fel: "Modulen finns inte, eller är inte öppen för dig." }, 404);
        if (m.kind !== "reading" && m.kind !== "ovning") return svar({ fel: "Ett prov blir klart när det rättas, och ett rollspel när det bedöms." }, 400);
        await klarModul(form({ modul_id: m.id, kurs_id: m.course_id }));
        const { data: gjord } = await db.from("module_progress").select("module_id").eq("employee_id", mig).eq("module_id", m.id).maybeSingle();
        if (!gjord) return svar({ fel: "Ta modulerna i ordning. Den här är inte öppen än." }, 400);
        await sparaBetyg(m.id, b.betyg);
        return klart(`${m.title} är klar.`);
      }
      case "prov": {
        const m = await modul(b.modul);
        if (!m || m.kind !== "quiz") return svar({ fel: "Provet finns inte, eller är inte öppet för dig." }, 404);
        const val = (b.svar ?? {}) as Record<string, unknown>;
        const f = form({ modul_id: m.id, kurs_id: m.course_id });
        for (const [q, o] of Object.entries(val)) if (UUID.test(q) && UUID.test(String(o))) f.set(`fraga_${q}`, String(o));
        const s = await lamnaQuiz({}, f);
        await sparaBetyg(m.id, b.betyg);
        revalidatePath("/utbildning", "layout");
        return svar(s.fel ? { fel: s.fel, resultat: s.resultat ?? null, provfel: true } : { ok: s.ok ?? "Inlämnat.", resultat: s.resultat ?? null });
      }
      case "betyg": {
        const m = await modul(b.modul);
        if (!m) return svar({ fel: "Modulen finns inte." }, 404);
        await sparaBetyg(m.id, b.betyg);
        return svar({ ok: "Tack för betyget." });
      }
      case "regel": {
        const t = text(b.text, 500);
        if (!t) return svar({ fel: "Regeln är tom." }, 400);
        if (b.bort) {
          await db.from("learning_rule").delete().eq("employee_id", mig).eq("text", t);
          return svar({ ok: "Borttagen ur din regelbok." });
        }
        const { data: k } = await rls.from("course").select("id").eq("slug", String(b.kurs ?? "")).maybeSingle();
        await db.from("learning_rule").upsert({ employee_id: mig, text: t, course_id: k?.id ?? null }, { onConflict: "employee_id,text" });
        return svar({ ok: "Sparad i din regelbok under Mina." });
      }
      case "anteckning": {
        // Reflektioner, förberedelser, mål ("mal:<modul>") och övningens bockar ("ovn:<modul>"). Bara dina.
        const key = String(b.key ?? "");
        if (!NYCKEL.test(key)) return svar({ fel: "Okänd anteckning." }, 400);
        const t = String(b.text ?? "").slice(0, 4000);
        if (!t.trim()) await db.from("learning_note").delete().eq("employee_id", mig).eq("key", key);
        else await db.from("learning_note").upsert({ employee_id: mig, key, text: t, updated_at: new Date().toISOString() }, { onConflict: "employee_id,key" });
        return svar({ ok: "Sparat." });
      }

      // ---------------------------------------------------------------- Repetitionen
      case "svar": {
        const qid = String(b.qid ?? "");
        const f = await facitFor(qid);
        if (!f) return svar({ fel: "Frågan finns inte i din repetition." }, 404);
        const ratt = String(b.val ?? "") === f.ratt;
        const sak = ["saker", "ganska", "gissade"].includes(String(b.sak)) ? String(b.sak) : "ganska";
        const kalla = ["repetition", "lektion", "team", "fortest", "uppfoljning"].includes(String(b.kalla)) ? String(b.kalla) : "repetition";
        // Spridd repetition: fel i morgon, gissat rätt om 2 dagar, säkert rätt om 7 och sedan tre gånger längre (21, 63 …), högst 90.
        const { data: fore } = await db.from("learning_answer").select("correct, confidence, answered_at, next_due").eq("employee_id", mig).eq("question_id", qid).order("answered_at", { ascending: false }).limit(1).maybeSingle();
        const forraIntervall = fore && fore.correct && fore.confidence !== "gissade" ? Math.round((Date.parse(`${fore.next_due}T12:00:00Z`) - Date.parse(`${svensktDatum(fore.answered_at)}T12:00:00Z`)) / 86400000) : 0;
        const dagar = !ratt ? 1 : sak === "gissade" ? 2 : forraIntervall >= 7 ? Math.min(90, forraIntervall * 3) : 7;
        const nasta = dagarBakat(idag, -dagar);
        await db.from("learning_answer").insert({ employee_id: mig, question_id: qid, correct: ratt, confidence: sak, source: kalla, next_due: nasta });
        return svar({ ok: "", ratt, nasta, dagar });
      }
      case "fornya": {
        // Ett certifikat förnyas med fem frågor ur kursen, alla rätt, i stället för att gå om hela kursen.
        const { data: k } = await rls.from("course").select("id, title, valid_months").eq("slug", String(b.kurs ?? "")).maybeSingle();
        if (!k || !k.valid_months) return svar({ fel: "Kursens certifikat går inte ut, så det finns inget att förnya." }, 400);
        const { data: cert } = await db.from("certification").select("id, expires_at").eq("employee_id", mig).eq("course_id", k.id).order("issued_at", { ascending: false }).limit(1).maybeSingle();
        if (!cert) return svar({ fel: "Du har inget certifikat på kursen att förnya. Gör kursen först." }, 400);
        const { data: mods } = await db.from("course_module").select("id").eq("course_id", k.id);
        const modIds = (mods ?? []).map((m) => m.id as string);
        type Fraga = { id: string; quiz_option: { id: string; is_correct: boolean }[] };
        const { data: fragRader } = modIds.length ? await db.from("quiz_question").select("id, quiz_option(id, is_correct)").in("module_id", modIds) : { data: null };
        const fragor = (fragRader ?? []) as unknown as Fraga[];
        const val = (b.svar ?? {}) as Record<string, unknown>;
        const besvarade = fragor.filter((q) => val[q.id] !== undefined);
        const kravs = Math.min(5, fragor.length);
        if (!kravs) return svar({ fel: "Kursen har inga frågor att förnya med." }, 400);
        if (besvarade.length < kravs) return svar({ fel: `Svara på ${kravs} frågor ur kursen.` }, 400);
        const fel = besvarade.filter((q) => q.quiz_option.find((o) => o.is_correct)?.id !== String(val[q.id]));
        if (fel.length) return svar({ fel: `${besvarade.length - fel.length} av ${besvarade.length} rätt. Alla måste vara rätt för att förnya. Läs kursen igen och försök sedan.` }, 400);
        await db.from("certification").insert({ employee_id: mig, course_id: k.id, expires_at: utgangsdatum(k.valid_months) });
        await loggaKurs(mig, "course.renewed", k.id, { fragor: besvarade.length, tidigare: cert.id });
        return klart(`Certifikatet i ${k.title} är förnyat i ${k.valid_months} månader.`);
      }
      case "rekommendera": {
        // "Rekommendera kurs": kursen visas först bland det rekommenderade för alla (nav_setting utb.rekommenderad).
        if (!chef) return svar({ fel: "Bara den som leder ett team rekommenderar kurser." }, 403);
        const { data: k } = await rls.from("course").select("slug, title").eq("slug", String(b.kurs ?? "")).eq("status", "published").maybeSingle();
        if (!k) return svar({ fel: "Kursen finns inte." }, 404);
        const { data: fore } = await db.from("nav_setting").select("value").eq("key", "utb.rekommenderad").maybeSingle();
        const kurser = ((fore?.value as { kurser?: string[] } | null)?.kurser ?? []).filter((x) => x !== k.slug);
        await db.from("nav_setting").upsert({ key: "utb.rekommenderad", value: { kurser: [k.slug, ...kurser].slice(0, 10) }, updated_by: mig, updated_at: new Date().toISOString() }, { onConflict: "key" });
        return klart(`${k.title} är rekommenderad för hela teamet.`);
      }
      case "teamrep": {
        if (!chef) return svar({ fel: "Bara den som leder ett team lägger frågor i teamets repetition." }, 403);
        const qid = String(b.qid ?? "");
        if (!UUID.test(qid)) return svar({ fel: "Frågan finns inte." }, 404);
        await db.from("team_repetition").upsert({ question_id: qid, added_by: mig, added_at: new Date().toISOString(), until: dagarBakat(idag, -14) }, { onConflict: "question_id" });
        return svar({ ok: "Frågan kommer i hela teamets repetition de närmaste två veckorna." });
      }

      // ---------------------------------------------------------------- Rollspel
      case "rollspel-forbered": {
        const m = await modul(b.modul);
        if (!m || m.kind !== "roleplay") return svar({ fel: "Rollspelet finns inte." }, 404);
        const s = await forberedRollspel(m.id, text(b.filnamn, 200) || "rollspel", String(b.mime ?? ""), Number(b.storlek ?? 0));
        return "fel" in s && s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Klar att ladda upp.", ...s, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null });
      }
      case "rollspel-registrera": {
        const s = await registreraRollspel(String(b.modul ?? ""), String(b.fil ?? ""), text(b.filnamn, 200) || "rollspel", String(b.store ?? ""));
        return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: s.ok ?? "Inspelningen är inlämnad." });
      }
      case "bedom": {
        const p = (b.poang ?? {}) as Record<string, unknown>;
        const f = form({ id: String(b.id ?? ""), note: text(b.note, 4000) });
        for (const [k, v] of Object.entries(p)) if (UUID.test(k)) f.set(`poang_${k}`, String(v));
        const s = await bedomRollspel({}, f);
        return s.fel ? svar({ fel: s.fel }, 400) : klart(s.ok ?? "Bedömningen är skickad.");
      }
      case "sjalv": {
        const m = await modul(b.modul);
        const kid = String(b.kriterium ?? "");
        const n = Number(b.poang);
        if (!m || !UUID.test(kid) || !Number.isInteger(n) || n < 1 || n > 5) return svar({ fel: "Bedömningen stämmer inte." }, 400);
        const { data: k } = await rls.from("roleplay_criterion").select("id").eq("id", kid).eq("module_id", m.id).maybeSingle();
        if (!k) return svar({ fel: "Kriteriet hör inte till rollspelet." }, 400);
        await db.from("roleplay_self").upsert({ employee_id: mig, module_id: m.id, criterion_id: kid, points: n, updated_at: new Date().toISOString() }, { onConflict: "employee_id,criterion_id" });
        return svar({ ok: "" });
      }

      // ---------------------------------------------------------------- Föreläsningar
      case "forelasning-ny": {
        if (!chef) return svar({ fel: "Bara den som leder ett team planerar föreläsningar." }, 403);
        const titel = text(b.titel, 200);
        if (!titel) return svar({ fel: "Skriv en rubrik." }, 400);
        const nar = tolkaNar(text(b.nar, 60), idag);
        if (!nar) return svar({ fel: "Skriv dag och tid, till exempel tor 22 okt 09:30." }, 400);
        const nyckel = (Array.isArray(b.nyckel) ? b.nyckel : []).map((x) => text(x, 300)).filter(Boolean).slice(0, 3);
        const skill = FARDIGHETER.includes(String(b.skill)) ? String(b.skill) : null;
        const { error } = await db.from("lecture").insert({ title: titel, starts_at: nar, presenter_id: mig, key_points: nyckel, skill, created_by: mig });
        if (error) return svar({ fel: error.message }, 400);
        return klart("Föreläsningen är skapad, med uppföljning dag 1, 3, 7 och 30.");
      }
      case "anmal": {
        const id = String(b.id ?? "");
        if (!UUID.test(id)) return svar({ fel: "Föreläsningen finns inte." }, 404);
        const { data: f } = await rls.from("lecture").select("id, title, starts_at, length_min, location, prep").eq("id", id).maybeSingle();
        if (!f) return svar({ fel: "Föreläsningen finns inte." }, 404);
        if (Date.parse(f.starts_at) < Date.now()) return svar({ fel: "Föreläsningen har redan varit." }, 400);
        const { error } = await db.from("lecture_signup").upsert({ lecture_id: id, employee_id: mig }, { onConflict: "lecture_id,employee_id" });
        if (error) return svar({ fel: error.message }, 400);
        const t = iStockholm(f.starts_at);
        const m = await skapaMote({ rubrik: f.title, dag: t.dag, start: t.min - (t.min % 5), minuter: Math.max(15, Math.min(480, f.length_min)), deltagare: [], plats: f.location, agenda: f.prep ?? "", paminnelse: 60 });
        return klart(m.fel ? `Anmäld. Mötet kom inte in i kalendern: ${m.fel}` : "Anmäld. Föreläsningen ligger i din kalender, med påminnelse en timme före.");
      }
      case "fraga":
      case "insikt": {
        const id = String(b.id ?? "");
        const t = text(b.text, 1000);
        if (!UUID.test(id) || !t) return svar({ fel: "Skriv något först." }, 400);
        const { data: f } = await rls.from("lecture").select("id, title, presenter_id").eq("id", id).maybeSingle();
        if (!f) return svar({ fel: "Föreläsningen finns inte." }, 404);
        await db.from("lecture_question").insert({ lecture_id: id, employee_id: mig, text: t, kind: handling });
        if (handling === "fraga" && f.presenter_id)
          await notifiera({ till: f.presenter_id, av: mig, kalla: "utbildning-fraga", typ: "kurs", rubrik: `${jagNamn} har en fråga inför ${f.title}`, detalj: t.slice(0, 200), href: "/utbildning" });
        return svar({ ok: handling === "fraga" ? "Frågan är skickad. Den tas upp på föreläsningen." : "Delat med teamet." });
      }
      case "uppfoljning": {
        const id = String(b.id ?? "");
        const steg = String(b.steg ?? "");
        if (!UUID.test(id) || !STEG.includes(steg)) return svar({ fel: "Uppföljningen stämmer inte." }, 400);
        const { data: f } = await rls.from("lecture").select("id").eq("id", id).maybeSingle();
        if (!f) return svar({ fel: "Föreläsningen finns inte." }, 404);
        await db.from("lecture_followup").upsert({ lecture_id: id, employee_id: mig, step: steg }, { onConflict: "lecture_id,employee_id,step" });
        return svar({ ok: "" });
      }

      // ---------------------------------------------------------------- Övrigt
      case "onska": {
        const q = text(b.q, 200);
        if (q.length < 2) return svar({ fel: "Skriv vad kursen ska handla om." }, 400);
        await db.from("course_wish").insert({ employee_id: mig, query: q });
        return svar({ ok: "Önskan är skickad. Den syns för dem som skriver kurser." });
      }
      case "pref": {
        const key = String(b.key ?? "");
        let value: unknown;
        if (key === "utb.reptid") {
          value = String(b.value ?? "");
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value as string)) return svar({ fel: "Välj en tid." }, 400);
        } else if (key === "utb.certpam") value = Boolean(b.value);
        else if (key === "utb.dolda") {
          // "Inte nu": kursen visas inte bland rekommendationerna på en vecka.
          const id = text(b.value, 120);
          const { data: p } = await db.from("nav_preference").select("value").eq("employee_id", mig).eq("key", key).maybeSingle();
          const fore = Object.fromEntries(Object.entries((p?.value ?? {}) as Record<string, string>).filter(([, till]) => till >= idag));
          value = b.bort ? Object.fromEntries(Object.entries(fore).filter(([k]) => k !== id)) : { ...fore, [id]: dagarBakat(idag, -7) };
        } else return svar({ fel: "Okänt val." }, 400);
        await db.from("nav_preference").upsert({ employee_id: mig, key, value, updated_at: new Date().toISOString() }, { onConflict: "employee_id,key" });
        return svar({ ok: "" });
      }
      case "uppgift": {
        // "Påminn mig 15:30", "Boka tid i kalendern", ett mål eller en övning med checklista: repots skapaUppgift.
        const titel = text(b.titel, 180);
        if (!titel) return svar({ fel: "Uppgiften saknar rubrik." }, 400);
        const dag = Math.max(0, Math.min(60, Number(b.dag) || 0));
        const tid = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.tid ?? "")) ? String(b.tid) : undefined;
        const min = Number(b.min) > 0 ? Math.min(480, Math.round(Number(b.min))) : undefined;
        const kurs = String(b.kurs ?? "");
        const { data: k } = kurs ? await rls.from("course").select("slug, title").eq("slug", kurs).maybeSingle() : { data: null };
        const s = await skapaUppgift({}, form({ title: titel, due_date: dagarBakat(idag, -dag), due_time: tid, estimate_minutes: min, priority: 3, description_md: k ? `Ur kursen [${k.title}](/utbildning/${k.slug}).` : undefined }));
        if (s.fel || !s.id) return svar({ fel: s.fel ?? "Uppgiften sparades inte." }, 400);
        const delar = (Array.isArray(b.delar) ? b.delar : []).map((x) => text(x, 180)).filter(Boolean).slice(0, 10);
        for (const d of delar) {
          const u = await skapaUppgift({}, form({ title: d, due_date: dagarBakat(idag, -dag), priority: 3, parent_id: s.id }));
          if (u.fel) return svar({ fel: `Uppgiften är lagd, men checklistan stannade: ${u.fel}` }, 400);
        }
        return svar({ ok: delar.length ? `Lagd i Uppgifter med ${delar.length} bockar.` : "Lagd i Uppgifter." });
      }
      case "paminn": {
        if (!chef) return svar({ fel: "Bara den som leder ett team påminner om kurser." }, 403);
        const vem = String(b.vem ?? "");
        if (!UUID.test(vem)) return svar({ fel: "Personen finns inte." }, 404);
        const { data: k } = await rls.from("course").select("slug, title").eq("slug", String(b.kurs ?? "")).maybeSingle();
        if (!k) return svar({ fel: "Kursen finns inte." }, 404);
        await notifiera({ till: vem, av: mig, kalla: "utbildning-paminn", typ: "kurs", rubrik: `Påminnelse: ${k.title}`, detalj: `${jagNamn} påminner dig om kursen.`, href: `/utbildning/${k.slug}` });
        return svar({ ok: "Påminnelsen är skickad." });
      }
      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
