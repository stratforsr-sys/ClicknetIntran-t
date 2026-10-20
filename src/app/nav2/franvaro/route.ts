import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fullName, getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { notifiera } from "@/lib/notishandelse-server";
import {
  avslutaSjuk,
  beslutaAnsokan,
  bekraftaSjuk,
  draTillbaka,
  forberedIntyg,
  kvitteraFrist,
  laggSjukanteckning,
  mataInSaldo,
  registreraIntyg,
  registreraSjuk,
  skickaAnsokan,
  type FranvaroState,
} from "@/app/(app)/franvaro/actions";
import { sparaTak } from "@/app/(app)/franvaro/regler/actions";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar frånvaron, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS. Ansöka, dra tillbaka, sjukanmäla (sig själv eller den man
 * leder), friskanmäla, bekräfta, besluta, anteckna och bemanningstaket går
 * genom app/(app)/franvaro — samma regler, samma frister och samma notiser.
 *
 * Det nya (0093): föreslå en annan period på en ansökan, kvittera
 * rehabsignalen, starta önskemålsrundan, och registrera annan frånvaro än sjuk
 * åt någon efter ett samtal (en godkänd ansökan som chefen lagt in; samma
 * krets som får registrera sjukanmälan åt någon).
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.franvaro` på false svarar rutten 423 innan något
 * skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
const fran = (s: FranvaroState, okText: string) => (s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: s.ok ?? okText }));

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const mig = user.employee.id;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b.handling ?? "");
  const id = String(b.id ?? "");

  if (!SKRIVLAGE.franvaro) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const idag = svensktDatum();
  // Samma krets som får registrera sjukanmälan åt någon: den som leder personen, säljchef och VD.
  const farLeda = async (person: string) => {
    if (hasRole(user, "sales_manager", "ceo")) return true;
    const { data } = await db.from("employee").select("manager_id").eq("id", person).maybeSingle();
    return data?.manager_id === mig;
  };

  try {
    switch (handling) {
      case "ansok":
        return fran(
          await skickaAnsokan({}, form({ typ: b.typ, fran: b.fran, till: b.till ?? b.fran, langd: b.till && b.till !== b.fran ? "flera" : "en_dag", deldag: b.deldag ? "1" : "", minuter: b.minuter ?? 0, skal: b.skal ?? "" })),
          "Skickat. Du får besked i Nav.",
        );
      case "saldo": {
        // Repots mataInSaldo: säljchef, VD och administratör; personen får en notis. Ett saldo läggs till och ändras aldrig.
        const pid = String(b.pid ?? "");
        if (!/^[0-9a-f-]{36}$/.test(pid)) return svar({ fel: "Ingen person vald." }, 400);
        // Ett tomt fält är inte noll dagar (Number("") är 0 i mataInSaldo).
        const dagar = String(b.dagar ?? "").trim().replace(",", ".");
        if (!/^\d{1,3}(\.\d)?$/.test(dagar)) return svar({ fel: "Ange antal dagar, till exempel 25 eller 12,5." }, 400);
        const typ = b.typ === "saved_vacation" ? "saved_vacation" : "vacation";
        return fran(
          await mataInSaldo({}, form({ employee_id: pid, typ, dagar, as_of: b.asof, intjanandear: typ === "saved_vacation" ? (b.ar ?? "") : "" })),
          "Saldot är inmatat. Personen får en notis.",
        );
      }
      case "dra":
        return fran(await draTillbaka({}, form({ id })), "Ansökan är tillbakadragen.");
      case "sjuk":
        return fran(await registreraSjuk({}, form({ for: b.for ?? "", forsta_dag: b.forsta, omfattning: b.omf ?? 100, mottagare: b.mottagare ?? "" })), "Sjukanmäld. Krya på dig.");
      case "frisk": {
        // Den egna öppna sjukperioden, om ingen anges.
        let sjukId = id;
        if (!UUID.test(sjukId)) {
          const { data } = await (await supabaseServer())
            .from("sick_report")
            .select("id, last_sick_day")
            .eq("employee_id", mig)
            .is("cancelled_at", null)
            .order("first_sick_day", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!data || (data.last_sick_day && data.last_sick_day < idag)) return svar({ fel: "Du har ingen pågående sjukanmälan." }, 400);
          sjukId = data.id as string;
        }
        return fran(await avslutaSjuk({}, form({ id: sjukId, sista_dag: b.sista })), "Välkommen tillbaka.");
      }
      case "bekrafta":
        return fran(await bekraftaSjuk({}, form({ id })), "Bekräftat.");
      case "anteckning":
        return fran(await laggSjukanteckning({}, form({ id, text: b.text ?? "" })), "Antecknat. Anteckningen går inte att ändra i efterhand.");
      case "beslut": {
        const beslut = b.beslut === "ja" ? "godkann" : b.beslut === "nej" ? "avsla" : "";
        return fran(await beslutaAnsokan({}, form({ id, beslut, motivering: b.motivering ?? "" })), beslut === "godkann" ? "Godkänt." : "Avslaget.");
      }
      case "tak": {
        const { data: jag } = await db.from("employee").select("team_id").eq("id", mig).maybeSingle();
        return fran(await sparaTak({}, form({ team_id: jag?.team_id ?? "", max_absent: b.tak })), "Taket är sparat.");
      }

      case "registrera": {
        // Chefen lägger in frånvaro efter ett samtal. Sjuk går genom repots sjukanmälan.
        const vem = String(b.vem ?? ""), typ = String(b.typ ?? ""), dag = String(b.dag ?? "");
        if (!UUID.test(vem) || !DATUM.test(dag)) return svar({ fel: "Välj person och dag." }, 400);
        if (typ === "sick") return fran(await registreraSjuk({}, form({ for: vem, forsta_dag: dag, omfattning: 100 })), "Sjukanmälan är registrerad.");
        if (!(await farLeda(vem))) return svar({ fel: "Du kan bara registrera frånvaro för dem du leder." }, 403);
        const { data: sort } = await db.from("absence_type").select("id").eq("id", typ).maybeSingle();
        if (!sort) return svar({ fel: "Okänd sort." }, 400);
        const nu = new Date().toISOString();
        const { data: rad, error } = await db
          .from("absence_request")
          .insert({ employee_id: vem, type_id: typ, starts_on: dag, ends_on: dag, status: "approved", submitted_at: nu, decided_by: mig, decided_at: nu, created_by: mig, reason: "Registrerad efter samtal" })
          .select("id")
          .single();
        if (error || !rad) return svar({ fel: `Frånvaron sparades inte: ${error?.message ?? "okänt fel"}` }, 500);
        await db.from("audit_log").insert({ actor_id: mig, action: "absence.registered_for", object_type: "absence_request", object_id: rad.id, meta: { employee_id: vem, typ, dag } });
        await notifiera({ till: vem, av: mig, kalla: "franvaro-registrerad", typ: "franvaro", rubrik: `${fullName(user.employee)} registrerade frånvaro för dig`, detalj: dag, href: "/franvaro", objekt: { typ: "absence_request", id: rad.id } });
        revalidatePath("/franvaro");
        return svar({ ok: "Registrerat. Personen får en notis." });
      }
      case "forslag": {
        // Ansökan står kvar; den som sökt ser förslaget och kan söka om.
        const a = String(b.fran ?? ""), t = String(b.till ?? "");
        if (!UUID.test(id) || !DATUM.test(a) || !DATUM.test(t) || t < a) return svar({ fel: "Välj en period." }, 400);
        const { data: ans } = await db.from("absence_request").select("id, employee_id, status").eq("id", id).maybeSingle();
        if (!ans || ans.status !== "submitted") return svar({ fel: "Ansökan väntar inte på beslut." }, 400);
        if (ans.employee_id === mig) return svar({ fel: "Du kan inte föreslå på din egen ansökan." }, 400);
        if (!(await farLeda(ans.employee_id as string))) return svar({ fel: "Du beslutar inte om den här ansökan." }, 403);
        await db.from("absence_proposal").insert({ request_id: id, starts_on: a, ends_on: t, note: String(b.note ?? "").trim() || null, proposed_by: mig });
        await notifiera({ till: ans.employee_id as string, av: mig, kalla: "franvaro-annan-period", typ: "franvaro", rubrik: `${fullName(user.employee)} föreslår en annan period`, detalj: `${a} – ${t}`, href: "/franvaro", objekt: { typ: "absence_request", id } });
        return svar({ ok: "Förslaget är skickat. Ansökan står kvar tills det är besvarat." });
      }
      case "rehab-ok": {
        if (!hasRole(user, "sales_manager", "ceo")) return svar({ fel: "Du saknar behörighet." }, 403);
        const vem = String(b.vem ?? "");
        if (!UUID.test(vem)) return svar({ fel: "Okänd person." }, 400);
        await db.from("sick_signal_ack").upsert({ employee_id: vem, occasions: Number(b.antal) || 0, acked_by: mig, acked_at: new Date().toISOString() }, { onConflict: "employee_id" });
        return svar({ ok: "Signalen döljs. Den kommer tillbaka om det blir fler tillfällen." });
      }
      case "intyg-mottaget":
        // "Intyg mottaget": intyget kom på papper, och fristen kvitteras utan fil.
        return fran(await kvitteraFrist({}, form({ id })), "Kvitterat: intyget kom på papper. Ingen fil sparas.");
      case "intyg-forbered": {
        const s = await forberedIntyg(String(b.rapport ?? ""), String(b.filnamn ?? "intyg"), String(b.mime ?? ""), Number(b.storlek ?? 0));
        return "fel" in s && s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Klar att ladda upp.", ...s, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null });
      }
      case "intyg-registrera":
        return fran(await registreraIntyg(String(b.rapport ?? ""), String(b.fil ?? ""), String(b.filnamn ?? "intyg"), String(b.store ?? "")), "Intyget är inlämnat. Det går bara till din chef, och varje öppning loggas.");
      case "fraga-instamplad": {
        // "Är allt okej? Hör av dig om du inte kommer i dag." till den som inte stämplat in.
        const vem = String(b.vem ?? "");
        if (!UUID.test(vem) || !(await farLeda(vem))) return svar({ fel: "Du kan bara fråga dem du leder." }, 403);
        await notifiera({ till: vem, av: mig, kalla: "tid-ostamplad", typ: "tid", rubrik: `${fullName(user.employee)} undrar: Är allt okej?`, detalj: "Hör av dig om du inte kommer i dag.", href: "/tid" });
        return svar({ ok: "Frågan är skickad." });
      }
      case "andringsfraga": {
        // Den som fått ledigt ber chefen ändra eller ställa in den: en uppgift till chefen, som gäller tills den är gjord.
        const { data: ans } = await (await supabaseServer()).from("absence_request").select("id, employee_id, starts_on, ends_on, status").eq("id", id).maybeSingle();
        if (!ans || ans.employee_id !== mig || ans.status !== "approved") return svar({ fel: "Ingen godkänd ledighet att ändra." }, 400);
        const { data: jag } = await db.from("employee").select("manager_id").eq("id", mig).maybeSingle();
        const chef = jag?.manager_id as string | null;
        if (!chef) return svar({ fel: "Du har ingen chef i Nav att fråga." }, 400);
        const { data: t } = await db
          .from("task")
          .insert({ title: `Ändra eller ställ in ledigheten för ${fullName(user.employee)} ${ans.starts_on}–${ans.ends_on}`, description_md: String(b.note ?? "").trim(), assignee_id: chef, created_by: mig, due_date: ans.starts_on, priority: 2 })
          .select("id")
          .single();
        if (t) await db.from("task_event").insert({ task_id: t.id, type: "skapad", by_employee_id: mig, note: null });
        await notifiera({ till: chef, av: mig, kalla: "uppgift-tilldelad", typ: "uppgift", rubrik: `${fullName(user.employee)} vill ändra eller ställa in sin ledighet`, detalj: `${ans.starts_on}–${ans.ends_on}`, href: t ? `/uppgifter/${t.id}` : "/franvaro" });
        return svar({ ok: "Frågan är skickad. Den gäller tills din chef svarat." });
      }
      case "runda": {
        // Utkastets datum: utskick 1 februari, svar 1 mars, besked 1 april.
        if (!hasRole(user, "sales_manager", "ceo", "team_lead")) return svar({ fel: "Du saknar behörighet." }, 403);
        const ar = Number(idag.slice(0, 4)) + (Number(idag.slice(5, 7)) >= 9 ? 1 : 0);
        const { data: jag } = await db.from("employee").select("team_id").eq("id", mig).maybeSingle();
        const { error } = await db.from("vacation_wish_round").insert({
          summer_year: ar,
          team_id: jag?.team_id ?? null,
          send_on: `${ar}-02-01`,
          answer_by: `${ar}-03-01`,
          decide_by: `${ar}-04-01`,
          created_by: mig,
        });
        if (error) return svar({ fel: /duplicate|unique/i.test(error.message) ? "Rundan för sommaren är redan startad." : error.message }, 400);
        return svar({ ok: "Önskemålsrundan skickas 1 februari, med svar senast 1 mars." });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
