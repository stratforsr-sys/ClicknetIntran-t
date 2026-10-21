import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fullName, getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { skickaEpost } from "@/lib/epost";
import { notifiera } from "@/lib/notishandelse-server";
import { PERMISSION_LABEL, PERMISSIONS, ROLES, type Permission, type Role } from "@/lib/roles";
import { perTabell } from "@/lib/personal-radering";
import { laggUppAnstalld } from "@/lib/anstallning-server";
import { anstalldaVerktyg, namnPa, startFran, type MallPunkt, type Person } from "@/lib/nav2/anstallda-start";
import {
  aktivera,
  andraBehorighet,
  andraRoll,
  aterstallLosenord,
  kvitteraOffboarding,
  kvitteraOnboarding,
  offboarda,
  sattOrganisation,
  skapaTeam,
  sparaTeam,
  taBortAnstalld,
  taBortTeam,
  hamtaReferenser,
} from "@/app/(app)/personal/actions";
import { skapaMote } from "@/app/(app)/kalender/moten/actions";
import { aeDue, arbetsdagar, AE_TYPER, frist, fyll } from "@/lib/nav2/anstalldaforma";
import { type Niva } from "@/lib/nav2/forma";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar Anställda, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS där de finns: lägga upp (`laggUppAnstalld`: konto, roll,
 * team, rutiner, kurser, schema), aktivera, nytt tillfälligt lösenord,
 * avsluta (`offboarda`: roller, bannlysning, ärenden), ta bort
 * (`taBortAnstalld` + `ta_bort_anstalld()`), bocka av och hoppa över
 * (`kvitteraOnboarding`, `kvitteraOffboarding`, AC-1.7), roller (`andraRoll`)
 * och team och chef (`sattOrganisation`). De kontrollerar själva att den
 * inloggade får hantera personal (säljchef, admin).
 *
 * Det nya (0105): checklistmallarna, utskicksreglerna, punkternas frister,
 * ägare, anteckningar, värden och påminnelser, fadder och fadderträffar,
 * välkomstbrevet, privat mejl, telefon, tredjeland och Behörighet i Nav.
 *
 * Gamla Nav C (2026-10-20): särskild behörighet (`andraBehorighet`, bara
 * säljchef och VD delar ut den, AC-13.13), vad en borttagning tar med sig
 * (GET `?referenser=`, `hamtaReferenser`) och teamen (`skapaTeam`,
 * `sparaTeam`, `taBortTeam`; teamledaren styr `leads_employee()`).
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.anstallda` på false svarar rutten 423 innan något skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const EPOST = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FORMER = ["permanent", "probation", "consultant", "intern"];
/** Slutorsaken, samma koder som 0110 `end_reason` och Rekryteringens LAS 25 §. */
const SLUTORSAK_TEXT: Record<string, string> = { egen: "egen uppsägning", arbetsbrist: "arbetsbrist", provanstallning: "provanställningen avbröts", visstid: "visstiden tog slut", avsked: "avsked", annat: "annat skäl" };
const SLUTORSAKER = Object.keys(SLUTORSAK_TEXT);
const NIVAER: Niva[] = ["salesperson", "admin", "superadmin"];
/** Befattningen som en nivå skriver (beställaren 2026-10-19). */
const ROLL_FOR: Record<Niva, Role> = { salesperson: "salesperson", admin: "sales_manager", superadmin: "admin" };

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
}
/** Repots ta bort avslutar med redirect(), som kastar. Den är ett ja. */
async function medOmdirigering(f: () => Promise<{ fel?: string } | undefined>): Promise<{ fel?: string }> {
  try {
    const s = await f();
    return s?.fel ? { fel: s.fel } : {};
  } catch (e) {
    const d = (e as { digest?: string })?.digest;
    if (typeof d === "string" && d.startsWith("NEXT_REDIRECT")) return {};
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}
async function fangad(f: () => Promise<unknown>): Promise<string | null> {
  try {
    await f();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Något gick fel.";
  }
}
function dagarMellan(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

type Punkt = {
  id: string; employee_id: string; label: string; state: string; kind: string; item_key: string | null; owner: string; owner_id: string | null;
  self_owned: boolean; rule_id: string | null; ask_for: string | null; reminded: string[] | null; offset_days: number | null; offset_special: string | null;
  due_date: string | null; created_on: string; sent_on: string | null; mail_subject: string | null; mail_body: string | null; condition: string | null;
};
const PUNKT = "id, employee_id, label, state, kind, item_key, owner, owner_id, self_owned, rule_id, ask_for, reminded, offset_days, offset_special, due_date, created_on, sent_on, mail_subject, mail_body, condition";

/** Gamla Nav C: vad en borttagning tar med sig, som "Visa vad som tas bort" på /personal/[id]. Läsning, svarar också i läsläge. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  const pid = new URL(request.url).searchParams.get("referenser") ?? "";
  if (!UUID.test(pid)) return svar({ fel: "Okänd person." }, 400);
  const { niva } = anstalldaVerktyg(supabaseAdmin(), { id: user.employee.id, namn: fullName(user.employee), epost: user.employee.email }, svensktDatum());
  if ((await niva(user.employee.id)) !== "superadmin") return svar({ fel: "Bara en superadmin ändrar i personalen." }, 403);
  try {
    const rader = await hamtaReferenser(pid);
    return svar({ ok: "", raderas: perTabell(rader.filter((r) => r.atgard === "raderas")), behalls: perTabell(rader.filter((r) => r.atgard === "behalls")) });
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Kunde inte läsa vad som hänger i personen." }, 403);
  }
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

  if (!SKRIVLAGE.anstallda) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const idag = svensktDatum();

  // ---------------------------------------------------------------- Hjälpare
  // Lägg upps steg och hjälparna de delar med Rekryteringens anställning (A7) ligger i anstallda-start.ts.
  const { personen, namnFor, logga, fyllFor, mejla, regelPunkter, mallPunkter, somRad, niva, meddelaSuperadmin, startaListan } = anstalldaVerktyg(
    db,
    { id: mig, namn: jagNamn, epost: user.employee.email },
    idag,
  );
  /** Punkten och vilken lista den ligger i. */
  const punkten = async (id: unknown): Promise<{ x: Punkt; tabell: "onboarding_task" | "offboarding_task" } | null> => {
    const rid = String(id ?? "");
    if (!UUID.test(rid)) return null;
    const { data: on } = await db.from("onboarding_task").select(PUNKT).eq("id", rid).maybeSingle();
    if (on) return { x: on as unknown as Punkt, tabell: "onboarding_task" };
    const { data: off } = await db.from("offboarding_task").select(PUNKT).eq("id", rid).maybeSingle();
    return off ? { x: off as unknown as Punkt, tabell: "offboarding_task" } : null;
  };
  const bas = (p: Person, tabell: string) => (tabell === "offboarding_task" ? p.end_date : p.start_date);
  const fristFor = (x: Punkt, p: Person, tabell: string) =>
    frist({ bas: bas(p, tabell), skapad: x.kind === "regel" ? (x.sent_on ?? x.created_on) : x.created_on, off: x.offset_days, spec: x.offset_special, flyttad: x.due_date });

  const klarMarkera = (tabell: string, pid: string, typ: string) =>
    db.from(tabell).update({ state: "done", handled_by: mig, handled_at: new Date().toISOString() }).eq("employee_id", pid).eq("kind", typ).eq("state", "open");
  /** Beställaren 2026-10-20 (A9): påminnelsen är en notis i Nav till den som ansvarar för punkten. Mejlet via Resend byggs ut senare. */
  const paminn = async (x: Punkt, p: Person, tabell: string): Promise<boolean> => {
    if ((x.reminded ?? []).includes(idag) || x.self_owned || !x.owner_id || x.state !== "open") return false;
    const mott = await namnFor(x.owner_id);
    if (!mott) return false;
    const due = fristFor(x, p, tabell);
    await notifiera({ till: x.owner_id, av: mig, kalla: "personal-paminn", typ: "uppgift", rubrik: `Påminnelse: ${x.label}`, detalj: `${namnPa(p)} · klart senast ${due}`, href: `/nav2/anstallda/klart?id=${x.id}`, objekt: { typ: "employee", id: p.id } });
    await db.from(tabell).update({ reminded: [...(x.reminded ?? []), idag] }).eq("id", x.id);
    await logga(p.id, `påminde ${mott.namn}: ${x.label}.`);
    return true;
  };
  // Beställaren 2026-10-19: bara en superadmin ändrar i personalen. Repots actions prövar dessutom kravChef().
  if ((await niva(mig)) !== "superadmin") return svar({ fel: "Bara en superadmin ändrar i personalen." }, 403);

  try {
    switch (handling) {
      // ---------------------------------------------------------------- Lägg upp anställd
      case "ny": {
        const f = (b.f && typeof b.f === "object" ? b.f : {}) as Record<string, unknown>;
        const roll = String(f.roll ?? "salesperson") as Role;
        if (!ROLES.includes(roll)) return svar({ fel: "Okänd roll." }, 400);
        const start = String(f.start ?? "");
        if (!DATUM.test(start)) return svar({ fel: "Välj en startdag." }, 400);
        const epost = str(f.jobbmejl, 200).toLowerCase();
        if (!EPOST.test(epost)) return svar({ fel: "Skriv jobbmejlet. Det blir inloggningen i navet." }, 400);
        const privat = str(f.privat, 200);
        if (privat && !EPOST.test(privat)) return svar({ fel: "Skriv en hel privat adress, till exempel namn@exempel.se." }, 400);
        const formen = FORMER.includes(String(f.form)) ? String(f.form) : "permanent";
        const teamId = UUID.test(String(f.team ?? "")) ? String(f.team) : null;
        const s = await laggUppAnstalld(
          { epost, fornamn: str(f.fornamn, 80), efternamn: str(f.efternamn, 80), roll, anstallningsform: formen, startdatum: start, anstallningsnummer: str(f.nr, 40) || null, teamId },
          mig,
        );
        if ("fel" in s) return svar({ fel: s.fel }, 400);
        const pid = s.employeeId;
        const st = await startaListan(pid, startFran(b, f, roll, teamId));
        if (!st) return svar({ fel: "Personen lades upp men gick inte att läsa tillbaka." }, 500);
        const p = st.p;
        revalidatePath("/personal");
        return svar({ ok: `${namnPa(p)} är upplagd i navet.`, anstalldId: pid, losenord: s.losenord });
      }

      // ---------------------------------------------------------------- Personkortet
      case "aktiv": {
        const p = await personen(b.pid);
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        const fel = await fangad(() => aktivera(form({ employee_id: p.id })));
        if (fel) return svar({ fel }, 400);
        return svar({ ok: `${p.first_name} är aktiv. Checklistan finns kvar i historiken.` });
      }
      case "losen": {
        const p = await personen(b.pid);
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        const s = (await aterstallLosenord({} as Parameters<typeof aterstallLosenord>[0], form({ employee_id: p.id }))) as { fel?: string; losenord?: string };
        if (s.fel || !s.losenord) return svar({ fel: s.fel ?? "Lösenordet gick inte att skapa." }, 400);
        return svar({ ok: "", losenord: s.losenord });
      }
      case "avslut": {
        const p = await personen(b.pid);
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        if (p.status === "offboarded") return svar({ fel: "Anställningen är redan avslutad." }, 400);
        const slut = String(b.slut ?? "");
        if (!DATUM.test(slut) || (p.start_date && slut < p.start_date)) return svar({ fel: `Välj en dag från ${p.start_date ?? "startdagen"}.` }, 400);
        // Beställaren 2026-10-20 (A10): avslutet frågar varför (0110 `end_reason`, Rekryteringens LAS 25 §).
        const orsak = String(b.orsak ?? "");
        if (!SLUTORSAKER.includes(orsak)) return svar({ fel: "Välj varför anställningen tar slut." }, 400);
        // Avslutslistan först: repots offboarda lägger bara in sin egen lista när det inte finns någon.
        const { data: mall } = await db.from("onboarding_template").select("id").eq("is_exit", true).maybeSingle();
        const punkter = mall ? await mallPunkter((mall as { id: string }).id, p, false) : [];
        const fpFore = await fyllFor(p);
        const { data: inlagda } = punkter.length ? await db.from("offboarding_task").insert(punkter.map((x, i) => somRad(x, p.id, i))).select("id") : { data: [] };
        const fel = await fangad(() => offboarda(form({ employee_id: p.id, slutdatum: slut })));
        if (fel) {
          const ids = ((inlagda ?? []) as unknown as { id: string }[]).map((x) => x.id);
          if (ids.length) await db.from("offboarding_task").delete().in("id", ids);
          return svar({ fel }, 400);
        }
        await klarMarkera("offboarding_task", p.id, "konto");
        // Repots egen lista hade börjat med de stängda ärendena. Här står antalet på punkten om ärendena.
        const { data: logg } = await db.from("audit_log").select("meta").eq("object_id", p.id).eq("action", "employee.offboarded").order("ts", { ascending: false }).limit(1).maybeSingle();
        const stangda = Number((logg as { meta: { stangda_arenden?: number } | null } | null)?.meta?.stangda_arenden ?? 0);
        if (stangda > 0) await db.from("offboarding_task").update({ note: `${stangda} öppet personalärende${stangda === 1 ? "" : "n"} stängdes automatiskt. Kontrollera att inget kräver åtgärd.` }).eq("employee_id", p.id).eq("item_key", "arenden");
        // Utan 0110 finns inte kolumnen. Då står orsaken bara i historiken, och Rekrytering frågar i efterhand.
        await db.from("employee").update({ end_reason: orsak, end_reason_by: mig, end_reason_at: new Date().toISOString() }).eq("id", p.id);
        const p2 = (await personen(p.id)) ?? p;
        const mejl = await regelPunkter(p2, "slut", [], "offboarding_task", punkter.length, fpFore);
        await meddelaSuperadmin(`${namnPa(p)} avslutas`, `${jagNamn} avslutade · sista dag ${slut} · ${SLUTORSAK_TEXT[orsak]}`, p.id);
        await logga(p.id, `startade avslutslistan (${SLUTORSAK_TEXT[orsak]})${mejl ? `. ${mejl} mejl gick ut` : ""}.`, { end_reason: orsak });
        return svar({ ok: `Anställningen är avslutad med sista dag ${slut}.${mejl ? ` ${mejl} mejl gick ut.` : ""}` });
      }
      case "radera": {
        const p = await personen(b.pid);
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        // Beställaren 2026-10-21: den som sägs upp ska också gå att ta bort, som i gamla Nav. Den som har börjat bekräftas
        // med namnet skrivet för hand (repots taBortAnstalld prövar det), och det som är företagets står kvar med namnet.
        if (p.id === mig) return svar({ fel: "Du kan inte ta bort dig själv." }, 400);
        const borjat = !(p.status === "onboarding" && (!p.start_date || p.start_date > idag));
        const bekraftelse = borjat ? String(b.bekraftelse ?? "") : namnPa(p);
        if (borjat && bekraftelse.replace(/\s+/g, " ").trim().toLowerCase() !== namnPa(p).replace(/\s+/g, " ").trim().toLowerCase())
          return svar({ fel: `Skriv ${namnPa(p)} för att bekräfta.` }, 400);
        const { data: oppna } = borjat ? { data: [] } : await db.from("onboarding_task").select(PUNKT).eq("employee_id", p.id).eq("kind", "regel").eq("state", "open");
        const besked = (oppna ?? []) as unknown as Punkt[];
        const s = await medOmdirigering(() => taBortAnstalld({} as Parameters<typeof taBortAnstalld>[0], form({ employee_id: p.id, bekraftelse })));
        if (s.fel) return svar({ fel: s.fel }, 400);
        if (borjat) return svar({ ok: `${namnPa(p)} är borttagen. Inloggningen är stängd, och det som är företagets står kvar med namnet.` });
        for (const x of besked) {
          if (x.self_owned || !x.owner_id) continue;
          const mott = await namnFor(x.owner_id);
          if (mott?.epost) await mejla(mott.epost, `Behövs inte: ${x.mail_subject ?? x.label}`, `Hej ${mott.namn.split(" ")[0]},\n\n${namnPa(p)} börjar inte. ${x.label} behövs inte.`, null, null);
        }
        return svar({ ok: `${namnPa(p)} är borttagen.${besked.length ? " Mottagarna av mejlen har fått besked." : ""}` });
      }

      // ---------------------------------------------------------------- Checklistan
      case "klar":
      case "hoppa": {
        const h = await punkten(b.rad);
        if (!h) return svar({ fel: "Punkten finns inte." }, 404);
        const { x, tabell } = h;
        const hoppa = handling === "hoppa";
        const skal = str(b.skal, 500);
        if (hoppa && !skal) return svar({ fel: "Skriv varför punkten hoppas över. Det krävs, och det syns i historiken." }, 400);
        const varde = str(b.varde, 200);
        if (!hoppa && x.ask_for && !varde) return svar({ fel: `Skriv ${x.ask_for.toLowerCase()}.` }, 400);
        if (!hoppa && x.ask_for === "E-postadress" && !EPOST.test(varde)) return svar({ fel: "Skriv en hel adress, till exempel namn@clicknet.se." }, 400);
        if (!hoppa && x.ask_for === "Lynes-användare") {
          const { data: upptagen } = await db.from("phone_identity").select("employee_id").eq("kind", "lynes_user").eq("value", varde).maybeSingle();
          if (upptagen && (upptagen as { employee_id: string }).employee_id !== x.employee_id) return svar({ fel: "Lynes-användaren hör redan till någon annan i navet." }, 400);
        }
        const kvittera = tabell === "onboarding_task" ? kvitteraOnboarding : kvitteraOffboarding;
        const fel = await fangad(() => kvittera(form({ task_id: x.id, employee_id: x.employee_id, hoppa: hoppa ? "1" : "0", motivering: skal })));
        if (fel) return svar({ fel }, 400);
        if (varde) {
          await db.from(tabell).update({ value: varde }).eq("id", x.id);
          if (x.ask_for === "Lynes-användare") {
            await db.from("phone_identity").delete().eq("employee_id", x.employee_id).eq("kind", "lynes_user");
            await db.from("phone_identity").insert({ employee_id: x.employee_id, kind: "lynes_user", value: varde, created_by: mig });
          }
        }
        // Jag gjorde det själv: mottagaren får veta att det redan är gjort.
        if (!hoppa && x.kind === "regel" && !x.self_owned && x.owner_id && x.owner_id !== mig) {
          const mott = await namnFor(x.owner_id);
          const p = await personen(x.employee_id);
          if (mott?.epost && p) await mejla(mott.epost, `Redan gjort: ${x.mail_subject ?? x.label}`, `Hej ${mott.namn.split(" ")[0]},\n\n${x.label} för ${namnPa(p)} är redan gjort. Du behöver inte göra något.`, null, null);
        }
        return svar({ ok: hoppa ? "Punkten är överhoppad, med motiveringen sparad." : `Klart: ${x.label}.` });
      }
      case "oppna": {
        const h = await punkten(b.rad);
        if (!h) return svar({ fel: "Punkten finns inte." }, 404);
        await db.from(h.tabell).update({ state: "open", skipped_reason: null, handled_by: null, handled_at: null }).eq("id", h.x.id);
        await logga(h.x.employee_id, `öppnade punkten igen: ${h.x.label}.`);
        return svar({ ok: "Punkten är öppen igen." });
      }
      case "not": {
        const h = await punkten(b.rad);
        if (!h) return svar({ fel: "Punkten finns inte." }, 404);
        await db.from(h.tabell).update({ note: str(b.text, 500) || null }).eq("id", h.x.id);
        return svar({ ok: "Anteckningen är sparad." });
      }
      case "flytta": {
        const h = await punkten(b.rad);
        if (!h) return svar({ fel: "Punkten finns inte." }, 404);
        const datum = String(b.datum ?? "");
        if (!DATUM.test(datum) || datum < idag) return svar({ fel: "Välj i dag eller ett senare datum." }, 400);
        await db.from(h.tabell).update({ due_date: datum }).eq("id", h.x.id);
        await logga(h.x.employee_id, `flyttade ${h.x.label} till ${datum}.`);
        return svar({ ok: `Nytt datum: ${datum}.` });
      }
      case "extra": {
        const p = await personen(b.pid);
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        const t = str(b.t, 120);
        if (!t) return svar({ fel: "Skriv punkten först." }, 400);
        const tabell = p.status === "offboarded" ? "offboarding_task" : "onboarding_task";
        const start = bas(p, tabell) ?? idag;
        const off = Math.max(-60, Math.min(365, Math.round(Number(b.off) || 0)));
        // Har personen redan börjat räknas en frist framåt från i dag, som i utkastet.
        const sparad = off >= 0 && start < idag ? dagarMellan(start, aeDue(idag, off)) : off;
        const { count } = await db.from(tabell).select("id", { count: "exact", head: true }).eq("employee_id", p.id);
        await db.from(tabell).insert({ employee_id: p.id, label: t, sort: count ?? 0, kind: "vanlig", offset_days: sparad, created_on: idag });
        await logga(p.id, `lade till: ${t}.`);
        return svar({ ok: "Punkten är tillagd." });
      }
      case "boka": {
        const h = await punkten(b.rad);
        if (!h) return svar({ fel: "Punkten finns inte." }, 404);
        const p = await personen(h.x.employee_id);
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        const intro = h.x.item_key === "intro";
        const due = fristFor(h.x, p, h.tabell);
        const dag = intro ? (p.start_date && p.start_date >= idag ? p.start_date : arbetsdagar(idag, 1)) : due < idag ? arbetsdagar(idag, 1) : due;
        const s = await skapaMote({
          rubrik: `${intro ? "Introduktion" : h.x.label} · ${namnPa(p)}`, dag, start: intro ? 540 : 840, minuter: intro ? 60 : 30, deltagare: [p.id],
          agenda: intro ? "Välkommen, veckans plan, frågor." : "Hur går det, vad behövs, nästa steg.", paminnelse: 60,
        });
        if (s.fel || !s.eventId) return svar({ fel: s.fel ?? "Mötet gick inte att boka." }, 400);
        await db.from(h.tabell).update({ state: "done", handled_by: mig, handled_at: new Date().toISOString(), calendar_event_id: s.eventId }).eq("id", h.x.id);
        await logga(p.id, `bokade ${intro ? "introduktionen" : h.x.label.toLowerCase()} ${dag} ${intro ? "09:00" : "14:00"}.`);
        return svar({ ok: `Bokat ${dag} ${intro ? "09:00" : "14:00"}, med ${p.first_name} inbjuden.`, eventId: s.eventId });
      }
      case "fadder": {
        const p = await personen(b.pid);
        const f = await personen(b.fadder);
        if (!p || !f) return svar({ fel: "Personen finns inte." }, 404);
        if (f.id === p.id || f.status === "offboarded") return svar({ fel: "Välj en aktiv kollega." }, 400);
        await db.from("employee_onboarding").upsert({ employee_id: p.id, mentor_id: f.id, updated_by: mig, updated_at: new Date().toISOString() });
        await klarMarkera("onboarding_task", p.id, "fadder");
        if (f.id !== mig) {
          await mejla(f.email, `Du är fadder för ${namnPa(p)}`, `Hej ${f.first_name},\n\nDu är fadder för ${namnPa(p)}${p.start_date ? `, som börjar ${p.start_date}` : ""}. Ni ses minst åtta gånger de första 90 dagarna.`, null, null);
          await notifiera({ till: f.id, av: mig, kalla: "personal-uppdrag", typ: "uppgift", rubrik: `Du är fadder för ${namnPa(p)}`, detalj: "Minst åtta träffar de första 90 dagarna", href: "/nav2", objekt: { typ: "employee", id: p.id } });
        }
        await logga(p.id, `gjorde ${namnPa(f)} till fadder.`);
        return svar({ ok: `${f.first_name} är fadder för ${p.first_name} och har fått ett mejl om uppdraget.` });
      }
      case "traff": {
        const p = await personen(b.pid);
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        const { data: o } = await db.from("employee_onboarding").select("mentor_meetings").eq("employee_id", p.id).maybeSingle();
        const n = Math.min(8, ((o as { mentor_meetings: number } | null)?.mentor_meetings ?? 0) + 1);
        await db.from("employee_onboarding").upsert({ employee_id: p.id, mentor_meetings: n, updated_by: mig, updated_at: new Date().toISOString() });
        await logga(p.id, `registrerade fadderträff ${n} av 8.`);
        return svar({ ok: `Träff ${n} av 8 är registrerad.` });
      }
      case "valkomst": {
        const p = await personen(b.pid);
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        const { data: o } = await db.from("employee_onboarding").select("private_email").eq("employee_id", p.id).maybeSingle();
        const privat = (o as { private_email: string | null } | null)?.private_email ?? "";
        if (!EPOST.test(privat)) return svar({ fel: "Privat mejl saknas. Lägg till det under Anställningen, så går brevet dit." }, 400);
        const v = { tid: str(b.tid, 5), plats: str(b.plats, 120), rad: str(b.rad, 300) };
        const schema = (Array.isArray(b.schema) ? (b.schema as unknown[][]) : []).slice(0, 10).map((r) => `${str(r[0], 5)}  ${str(r[1], 120)}`).join("\n");
        const text = `Hej ${p.first_name},\n\nVälkommen till Clicknet! Vi ses ${p.start_date ?? ""} klockan ${v.tid}${v.plats ? `, ${v.plats}` : ""}.${v.rad ? `\n\n${v.rad}` : ""}${schema ? `\n\nFörsta dagen:\n${schema}` : ""}\n\nHälsningar\n${jagNamn}`;
        const u = await skickaEpost({ till: privat, amne: "Välkommen till Clicknet", text, svaraTill: user.employee.email });
        if (!u.skickat) return svar({ fel: `Brevet gick inte iväg: ${u.orsak}` }, 502);
        await db.from("employee_onboarding").upsert({ employee_id: p.id, welcome: v, welcome_sent_at: new Date().toISOString(), welcome_sent_to: privat, updated_by: mig, updated_at: new Date().toISOString() });
        await klarMarkera("onboarding_task", p.id, "valkomst");
        await logga(p.id, `skickade välkomstbrevet till ${privat}.`);
        return svar({ ok: `Välkomstbrevet är skickat till ${privat}.` });
      }

      // ---------------------------------------------------------------- Utskicken
      case "paminn": {
        const h = await punkten(b.rad);
        if (!h) return svar({ fel: "Punkten finns inte." }, 404);
        const p = await personen(h.x.employee_id);
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        if ((h.x.reminded ?? []).includes(idag)) return svar({ fel: "Du har redan påmint i dag." }, 400);
        const ok = await paminn(h.x, p, h.tabell);
        return ok ? svar({ ok: "Påminnelsen är skickad." }) : svar({ fel: "Det finns ingen att påminna." }, 400);
      }
      case "paminnalla":
      case "paminnp": {
        const mott = handling === "paminnalla" ? String(b.mott ?? "") : null;
        const pid = handling === "paminnp" ? String(b.pid ?? "") : null;
        if ((mott && !UUID.test(mott)) || (pid && !UUID.test(pid))) return svar({ fel: "Ogiltig begäran." }, 400);
        let n = 0;
        for (const tabell of ["onboarding_task", "offboarding_task"] as const) {
          let q = db.from(tabell).select(PUNKT).eq("kind", "regel").eq("state", "open").eq("self_owned", false);
          if (mott) q = q.eq("owner_id", mott);
          if (pid) q = q.eq("employee_id", pid);
          const { data } = await q;
          for (const x of (data ?? []) as unknown as Punkt[]) {
            const p = await personen(x.employee_id);
            if (p && (await paminn(x, p, tabell))) n++;
          }
        }
        return n ? svar({ ok: `${n === 1 ? "En påminnelse" : `${n} påminnelser`} skickade.` }) : svar({ fel: "Alla är redan påminda i dag." }, 400);
      }
      case "byt": {
        const h = await punkten(b.rad);
        if (!h || h.x.kind !== "regel") return svar({ fel: "Punkten finns inte." }, 404);
        const till = await personen(b.till);
        const p = await personen(h.x.employee_id);
        if (!till || !p || till.status === "offboarded") return svar({ fel: "Välj en aktiv kollega." }, 400);
        const fore = await namnFor(h.x.owner_id);
        const { data: r } = h.x.rule_id ? await db.from("onboarding_rule").select("subject, body").eq("id", h.x.rule_id).maybeSingle() : { data: null };
        const fp = await fyllFor(p);
        const regel = r as { subject: string; body: string } | null;
        const amne = regel ? fyll(regel.subject, fp, namnPa(till), jagNamn) : h.x.mail_subject;
        const text = regel ? fyll(regel.body, fp, namnPa(till), jagNamn) : h.x.mail_body;
        await db.from(h.tabell).update({ owner_id: till.id, self_owned: till.id === mig, sent_on: idag, reminded: [], auto_reminded_on: null, mail_subject: amne, mail_body: text }).eq("id", h.x.id);
        const due = frist({ bas: bas(p, h.tabell), skapad: idag, off: h.x.offset_days, spec: null, flyttad: h.x.due_date });
        if (till.id !== mig) {
          await mejla(till.email, amne ?? h.x.label, text ?? h.x.label, h.x.id, due);
          await notifiera({ till: till.id, av: mig, kalla: "personal-uppdrag", typ: "uppgift", rubrik: amne ?? h.x.label, detalj: `Klart senast ${due}`, href: `/nav2/anstallda/klart?id=${h.x.id}`, objekt: { typ: "employee", id: p.id } });
        }
        if (fore?.epost && h.x.owner_id !== mig && !h.x.self_owned)
          await mejla(fore.epost, `Behövs inte: ${h.x.mail_subject ?? h.x.label}`, `Hej ${fore.namn.split(" ")[0]},\n\n${h.x.label} för ${namnPa(p)} görs av någon annan. Du behöver inte göra något.`, null, null);
        await logga(p.id, `skickade ${h.x.label} till ${namnPa(till)}${fore ? ` i stället för ${fore.namn}` : ""}.`);
        return svar({ ok: till.id === mig ? "Punkten ligger nu i din lista." : `Mejlet gick till ${till.first_name}.` });
      }

      // ---------------------------------------------------------------- Anställningen
      case "andra": {
        const p = await personen(b.pid);
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        const f = (b.f && typeof b.f === "object" ? b.f : {}) as Record<string, unknown>;
        const start = String(f.start ?? "");
        if (!DATUM.test(start)) return svar({ fel: "Välj en startdag." }, 400);
        const jobbmejl = str(f.jobbmejl, 200).toLowerCase();
        if (!EPOST.test(jobbmejl)) return svar({ fel: "Skriv en hel adress, till exempel namn@clicknet.se." }, 400);
        const privat = str(f.privat, 200);
        if (privat && !EPOST.test(privat)) return svar({ fel: "Skriv en hel adress, till exempel namn@exempel.se." }, 400);
        const formen = FORMER.includes(String(f.form)) ? String(f.form) : p.employment_type;
        const tredje = f.tredje === true;
        if (jobbmejl !== p.email.toLowerCase()) {
          const { data: finns } = await db.from("employee").select("id").eq("email", jobbmejl).maybeSingle();
          if (finns) return svar({ fel: "Det finns redan en anställd med den e-postadressen." }, 400);
          // Jobbmejlet är inloggningen: kontot i auth byter adress i samma steg.
          const { data: a } = await db.from("employee").select("auth_user_id").eq("id", p.id).maybeSingle();
          const auth = (a as { auth_user_id: string | null } | null)?.auth_user_id;
          if (auth) {
            const { error } = await db.auth.admin.updateUserById(auth, { email: jobbmejl, email_confirm: true });
            if (error) return svar({ fel: `Inloggningen kunde inte byta adress: ${error.message}` }, 400);
          }
        }
        await db.from("employee").update({ start_date: start, employment_type: formen, email: jobbmejl }).eq("id", p.id);
        const teamId = UUID.test(String(f.team ?? "")) ? String(f.team) : null;
        const chefId = UUID.test(String(f.chef ?? "")) ? String(f.chef) : null;
        if (teamId !== p.team_id || chefId !== p.manager_id) {
          const fel = await fangad(() => sattOrganisation(form({ employee_id: p.id, team_id: teamId ?? "", manager_id: chefId ?? "" })));
          if (fel) return svar({ fel }, 400);
        }
        await db.from("employee_onboarding").upsert({ employee_id: p.id, private_email: privat || null, phone: str(f.tel, 40) || null, third_country: tredje, updated_by: mig, updated_at: new Date().toISOString() });
        // Villkorade punkter: läggs till eller tas bort när provanställningen eller tredjeland ändras (utkastets aeSynka).
        const { data: o } = await db.from("employee_onboarding").select("template_id").eq("employee_id", p.id).maybeSingle();
        const mallId = (o as { template_id: string | null } | null)?.template_id;
        if (mallId && p.status === "onboarding") {
          const { data: alla } = await db.from("onboarding_template_item").select("key, label, offset_days, offset_special, kind, law_ref, condition, owner, owner_id, sort").eq("template_id", mallId).not("condition", "is", null);
          const { data: har } = await db.from("onboarding_task").select("id, item_key, state").eq("employee_id", p.id);
          const finns = (har ?? []) as unknown as { id: string; item_key: string | null; state: string }[];
          for (const m of (alla ?? []) as unknown as MallPunkt[]) {
            const ska = m.condition === "tredje" ? tredje : formen === "probation";
            const rad = finns.find((x) => x.item_key === m.key);
            if (ska && !rad) await db.from("onboarding_task").insert(somRad(m, p.id, m.sort));
            if (!ska && rad && rad.state === "open") await db.from("onboarding_task").delete().eq("id", rad.id);
          }
        }
        await logga(p.id, `ändrade anställningen${start !== p.start_date ? `: startdagen är nu ${start}` : ""}.`);
        return svar({ ok: start !== p.start_date ? `Sparat. Datumen i checklistan räknas nu från ${start}.` : "Sparat." });
      }
      case "roll": {
        const p = await personen(b.pid);
        const roll = String(b.roll ?? "") as Role;
        if (!p || !ROLES.includes(roll)) return svar({ fel: "Ogiltig begäran." }, 400);
        const { data: r } = await db.from("employee_role").select("role").eq("employee_id", p.id);
        const har = ((r ?? []) as unknown as { role: string }[]).map((x) => x.role);
        const pa = !har.includes(roll);
        if (!pa && har.length === 1) return svar({ fel: `${p.first_name} behöver minst en roll för att kunna logga in. Lägg till den nya först.` }, 400);
        const fel = await fangad(() => andraRoll(form({ employee_id: p.id, roll, pa: pa ? "1" : "0" })));
        if (fel) return svar({ fel }, 400);
        return svar({ ok: pa ? "Rollen är tillagd." : "Rollen är borttagen." });
      }
      case "behorighet": {
        const p = await personen(b.pid);
        const ny = String(b.niva ?? "") as Niva;
        if (!p || !NIVAER.includes(ny)) return svar({ fel: "Ogiltig begäran." }, 400);
        if ((await niva(mig)) !== "superadmin") return svar({ fel: "Bara en superadmin ändrar behörigheten i Nav." }, 403);
        if (p.id === mig) return svar({ fel: "Du kan inte ändra din egen behörighet." }, 400);
        if (ny !== "superadmin" && (await niva(p.id)) === "superadmin") {
          const { data: aktiva } = await db.from("employee").select("id").neq("status", "offboarded");
          let andra = 0;
          for (const a of (aktiva ?? []) as unknown as { id: string }[]) if (a.id !== p.id && (await niva(a.id)) === "superadmin") andra++;
          if (!andra) return svar({ fel: "Nav behöver minst en superadmin." }, 400);
        }
        // Beställaren 2026-10-19: nivån skriver befattningen, så att navet följer den med dagens regler.
        // Säljare = säljare, Admin = säljchef, Superadmin = administratör. Övriga befattningar tas bort.
        const roll = ROLL_FOR[ny];
        const { data: r } = await db.from("employee_role").select("role").eq("employee_id", p.id);
        const fore = ((r ?? []) as unknown as { role: string }[]).map((x) => x.role);
        if (!fore.includes(roll)) {
          await db.from("employee_role").upsert({ employee_id: p.id, role: roll, granted_by: mig });
          await db.from("audit_log").insert({ actor_id: mig, action: "role.granted", object_type: "employee", object_id: p.id, meta: { roll } });
        }
        for (const x of fore.filter((x) => x !== roll)) {
          await db.from("employee_role").delete().eq("employee_id", p.id).eq("role", x);
          await db.from("audit_log").insert({ actor_id: mig, action: "role.revoked", object_type: "employee", object_id: p.id, meta: { roll: x } });
        }
        // Nivån räknas ur befattningen från och med nu. En nivå satt för hand vore en andra sanning.
        await db.from("employee_access_level").delete().eq("employee_id", p.id);
        const namn = ny === "superadmin" ? "Superadmin" : ny === "admin" ? "Admin" : "Säljare";
        await notifiera({ till: p.id, av: mig, kalla: "konto-roll", typ: "konto", rubrik: `Din behörighet i Nav är nu ${namn}`, detalj: "Menyn kan se annorlunda ut vid nästa sidbyte", href: "/nav2", objekt: { typ: "employee", id: p.id } });
        await logga(p.id, `ändrade behörigheten i Nav till ${namn.toLowerCase()}.`, { niva: ny });
        revalidatePath(`/personal/${p.id}`);
        return svar({ ok: `${p.first_name} är nu ${namn.toLowerCase()}.` });
      }
      case "sarskild": {
        // Per person, aldrig per roll. Beställaren 2026-10-21: superadmin delar ut den (prövat ovan). Repots andraBehorighet
        // släpper bara säljchef och VD, så samma skrivning, logg och notis görs här: säljchef och VD går fortfarande via den.
        const p = await personen(b.pid);
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        if (p.status === "offboarded") return svar({ fel: "Anställningen är avslutad." }, 400);
        const beh = String(b.beh ?? "") as Permission;
        if (!PERMISSIONS.includes(beh)) return svar({ fel: "Okänd behörighet." }, 400);
        if (hasRole(user, "sales_manager", "ceo")) {
          const f = await fangad(() => andraBehorighet(form({ employee_id: p.id, behorighet: beh, pa: b.pa === true ? "1" : "0" })));
          if (f) return svar({ fel: f }, 403);
        } else {
          const { error } = b.pa === true
            ? await db.from("employee_permission").upsert({ employee_id: p.id, permission: beh, granted_by: mig })
            : await db.from("employee_permission").delete().eq("employee_id", p.id).eq("permission", beh);
          if (error) return svar({ fel: "Behörigheten kunde inte sparas." }, 500);
          await db.from("audit_log").insert({ actor_id: mig, action: b.pa === true ? "permission.granted" : "permission.revoked", object_type: "employee", object_id: p.id, meta: { behorighet: beh } });
          await notifiera({ till: p.id, av: mig, kalla: "konto-behorighet", typ: "konto", rubrik: b.pa === true ? `Du har fått behörigheten ${PERMISSION_LABEL[beh]}` : `Behörigheten ${PERMISSION_LABEL[beh]} är borttagen`, detalj: b.pa === true ? "Den öppnar en ny vy för dig" : "Vyn den öppnade är stängd igen", href: `/personal/${p.id}`, objekt: { typ: "employee", id: p.id } });
          revalidatePath(`/personal/${p.id}`);
        }
        return svar({ ok: b.pa === true ? `${namnPa(p)} har fått behörigheten. Den loggas, och ${namnPa(p).split(" ")[0]} får en notis.` : "Behörigheten är borttagen och loggad." });
      }

      case "team-ny": {
        const namn = str(b.namn, 80);
        const s = await skapaTeam({}, form({ namn }));
        return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: s.ok ?? `Teamet ${namn} är skapat.` });
      }

      case "team-spara": {
        // Namn och teamledare i ett svep (repots sparaTeam). Ledaren ser medlemmarnas uppgifter (leads_employee()).
        const tid = String(b.id ?? ""), namn = str(b.namn, 80), ledare = String(b.ledare ?? "");
        if (!UUID.test(tid)) return svar({ fel: "Okänt team." }, 400);
        if (!namn) return svar({ fel: "Teamet behöver ett namn." }, 400);
        const { data: t } = await db.from("team").select("id, name, lead_id").eq("id", tid).maybeSingle();
        if (!t) return svar({ fel: "Teamet finns inte." }, 404);
        const { data: krock } = await db.from("team").select("id").ilike("name", namn).neq("id", tid).limit(1);
        if (krock?.length) return svar({ fel: "Det finns redan ett team med det namnet." }, 400);
        if (ledare) {
          const l = await personen(ledare);
          if (!l || l.status === "offboarded") return svar({ fel: "Teamledaren finns inte." }, 404);
        }
        const f = await fangad(() => sparaTeam(form({ team_id: tid, namn, lead_id: ledare })));
        if (f) return svar({ fel: f }, 403);
        return svar({ ok: ledare && ledare !== t.lead_id ? `Sparat. ${(await namnFor(ledare))?.namn ?? "Ledaren"} ser nu medlemmarnas uppgifter.` : "Teamet är sparat." });
      }

      case "team-bort": {
        // Bara ett tomt team (repots taBortTeam gör annars ingenting): ingen ska tyst byta vem som ser vem.
        const tid = String(b.id ?? "");
        if (!UUID.test(tid)) return svar({ fel: "Okänt team." }, 400);
        const { count } = await db.from("employee").select("id", { count: "exact", head: true }).eq("team_id", tid);
        if ((count ?? 0) > 0) return svar({ fel: "Teamet har medlemmar. Flytta dem först, en i taget." }, 400);
        const f = await fangad(() => taBortTeam(form({ team_id: tid })));
        if (f) return svar({ fel: f }, 403);
        return svar({ ok: "Teamet är borttaget." });
      }

      case "utbpamin": {
        const p = await personen(b.pid);
        if (!p) return svar({ fel: "Personen finns inte." }, 404);
        await notifiera({ till: p.id, av: mig, kalla: "personal-paminn", typ: "kurs", rubrik: "Påminnelse: kurser och rutiner", detalj: `${jagNamn} påminner om det som är kvar`, href: "/nav2", objekt: { typ: "employee", id: p.id } });
        await logga(p.id, "påminde om kurserna och rutinerna.");
        return svar({ ok: `${p.first_name} får en påminnelse i Nav om det som är kvar.` });
      }

      // ---------------------------------------------------------------- Checklistor
      case "mall": {
        const m = (b.mall && typeof b.mall === "object" ? b.mall : {}) as Record<string, unknown>;
        const namn = str(m.namn, 40);
        if (!namn) return svar({ fel: "Checklistan behöver ett namn." }, 400);
        const roller = (Array.isArray(m.roller) ? (m.roller as unknown[]).map(String) : []).filter((r) => (ROLES as readonly string[]).includes(r));
        const punkter = (Array.isArray(m.punkter) ? (m.punkter as Record<string, unknown>[]) : []).slice(0, 80);
        let id = UUID.test(String(m.id ?? "")) ? String(m.id) : null;
        const { data: fanns } = id ? await db.from("onboarding_template").select("id, is_exit").eq("id", id).maybeSingle() : { data: null };
        const slut = Boolean((fanns as { is_exit: boolean } | null)?.is_exit);
        if (id && !fanns) id = null;
        if (id) await db.from("onboarding_template").update({ name: namn, roles: slut ? [] : roller, updated_at: new Date().toISOString() }).eq("id", id);
        else {
          const { count } = await db.from("onboarding_template").select("id", { count: "exact", head: true });
          const { data: ny, error } = await db.from("onboarding_template").insert({ name: namn, roles: roller, sort: (count ?? 0) + 1, created_by: mig }).select("id").single();
          if (error || !ny) return svar({ fel: "Checklistan kunde inte sparas." }, 400);
          id = (ny as { id: string }).id;
        }
        // En roll föreslår en lista: den som får rollen här släpper den i de andra.
        if (!slut && roller.length) {
          const { data: andra } = await db.from("onboarding_template").select("id, roles").neq("id", id).eq("is_exit", false);
          for (const a of (andra ?? []) as unknown as { id: string; roles: string[] }[]) {
            const kvar = (a.roles ?? []).filter((r) => !roller.includes(r));
            if (kvar.length !== (a.roles ?? []).length) await db.from("onboarding_template").update({ roles: kvar }).eq("id", a.id);
          }
        }
        const sedda = new Set<string>();
        const rader = punkter
          .map((x, i) => {
            let key = String(x.id ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || `p${i}`;
            while (sedda.has(key)) key = `${key.slice(0, 36)}-${i}`;
            sedda.add(key);
            const off = x.off === "skv" || x.off === "prov" ? null : Math.max(-60, Math.min(365, Math.round(Number(x.off) || 0)));
            const typ = (AE_TYPER as readonly string[]).includes(String(x.typ)) ? String(x.typ) : "vanlig";
            const agId = UUID.test(String(x.agId ?? "")) ? String(x.agId) : null;
            const ag = x.ag === "fadder" ? "fadder" : agId ? "person" : "chef";
            return {
              template_id: id, key, label: str(x.t, 120), offset_days: off, offset_special: off === null ? String(x.off) : null, kind: typ,
              law_ref: str(x.lag, 80) || null, condition: x.villkor === "tredje" || x.villkor === "prov" ? String(x.villkor) : null, owner: ag, owner_id: ag === "person" ? agId : null, sort: i,
            };
          })
          .filter((x) => x.label);
        await db.from("onboarding_template_item").delete().eq("template_id", id);
        if (rader.length) {
          const { error } = await db.from("onboarding_template_item").insert(rader);
          if (error) return svar({ fel: `Punkterna kunde inte sparas: ${error.message}` }, 400);
        }
        return svar({ ok: "", id });
      }
      case "mall-ta-bort": {
        const id = String(b.id ?? "");
        const { data: m } = UUID.test(id) ? await db.from("onboarding_template").select("is_exit, name").eq("id", id).maybeSingle() : { data: null };
        if (!m) return svar({ fel: "Checklistan finns inte." }, 404);
        if ((m as { is_exit: boolean }).is_exit) return svar({ fel: "Avslutslistan går inte att ta bort." }, 400);
        const { count } = await db.from("onboarding_template").select("id", { count: "exact", head: true }).eq("is_exit", false);
        if ((count ?? 0) <= 1) return svar({ fel: "Det behövs minst en checklista för den som börjar." }, 400);
        await db.from("onboarding_template").delete().eq("id", id);
        return svar({ ok: `Checklistan ${(m as { name: string }).name} är borttagen.` });
      }

      // ---------------------------------------------------------------- Utskick
      case "regel": {
        const r = (b.regel && typeof b.regel === "object" ? b.regel : {}) as Record<string, unknown>;
        const falt = {
          name: str(r.namn, 60), recipient_id: UUID.test(String(r.mottId ?? "")) ? String(r.mottId) : null,
          roles: r.roller === "alla" || !Array.isArray(r.roller) ? null : (r.roller as unknown[]).map(String).filter((x) => (ROLES as readonly string[]).includes(x)),
          trigger: r.trigger === "slut" ? "slut" : "start", due_offset: Math.max(-30, Math.min(30, Math.round(Number(r.klart) || 0))),
          remind_days: Math.max(1, Math.min(3, Math.round(Number(r.pamin) || 2))), ask_for: str(r.fraga, 40) || null,
          subject: str(r.amne, 80), body: str(r.text, 800), active: r.aktiv !== false, updated_at: new Date().toISOString(),
        };
        if (!falt.name) return svar({ fel: "Skriv vad som ska göras, till exempel Lynes-konto." }, 400);
        if (!falt.recipient_id) return svar({ fel: "Välj vem som gör det." }, 400);
        if (!falt.subject || !falt.body) return svar({ fel: "Skriv ämne och mejl." }, 400);
        const id = UUID.test(String(r.id ?? "")) ? String(r.id) : null;
        if (id) await db.from("onboarding_rule").update(falt).eq("id", id);
        else await db.from("onboarding_rule").insert({ ...falt, created_by: mig });
        return svar({ ok: id ? "Regeln är sparad. Pågående mejl påverkas inte." : `Regeln är sparad. Den gäller nästa gång någon ${falt.trigger === "slut" ? "slutar" : "läggs upp"}.` });
      }
      case "regel-pa": {
        const id = String(b.id ?? "");
        const { data: r } = UUID.test(id) ? await db.from("onboarding_rule").select("active, name").eq("id", id).maybeSingle() : { data: null };
        if (!r) return svar({ fel: "Regeln finns inte." }, 404);
        const pa = !(r as { active: boolean }).active;
        await db.from("onboarding_rule").update({ active: pa, updated_at: new Date().toISOString() }).eq("id", id);
        return svar({ ok: pa ? `Regeln är på: ${(r as { name: string }).name}.` : `Regeln är av: ${(r as { name: string }).name}. Pågående mejl påverkas inte.` });
      }
      case "regel-ta-bort": {
        const id = String(b.id ?? "");
        if (!UUID.test(id)) return svar({ fel: "Regeln finns inte." }, 404);
        await db.from("onboarding_rule").delete().eq("id", id);
        return svar({ ok: "Regeln är borttagen." });
      }
      case "regel-test": {
        const id = String(b.id ?? "");
        const { data: r } = UUID.test(id) ? await db.from("onboarding_rule").select("subject, body, recipient_id").eq("id", id).maybeSingle() : { data: null };
        if (!r) return svar({ fel: "Regeln finns inte." }, 404);
        const ex = (await personen(b.pid)) ?? (await personen(mig));
        if (!ex) return svar({ fel: "Det finns ingen att visa mejlet med." }, 400);
        const fp = await fyllFor(ex);
        const regel = r as { subject: string; body: string; recipient_id: string | null };
        const mott = await namnFor(regel.recipient_id);
        const amne = fyll(regel.subject, fp, mott?.namn ?? "", jagNamn);
        const u = await skickaEpost({ till: user.employee.email, amne: `Test: ${amne}`, text: `${fyll(regel.body, fp, mott?.namn ?? "", jagNamn)}\n\n(Ett test med ${fp.namn}. Ingen punkt skapades.)` });
        if (!u.skickat) return svar({ fel: `Testet gick inte iväg: ${u.orsak}` }, 502);
        return svar({ ok: `Ett testmejl är skickat till dig: ”${amne}”.` });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
