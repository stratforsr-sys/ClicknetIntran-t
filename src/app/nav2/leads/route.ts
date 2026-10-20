import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fullName, getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svenskTidpunkt, svensktDatum } from "@/lib/klocka";
import { notifiera } from "@/lib/notishandelse-server";
import { skrivHandelse } from "@/lib/handelselogg-server";
import { leadTitel, maskeraPersonnummer } from "@/lib/leads";
import { tilldelaLead, uppdateraLead } from "@/app/(app)/leads/actions";
import { skapaMote, stallIn } from "@/app/(app)/kalender/moten/actions";
import { farFordela } from "@/lib/nav2/leads";
import { ANGRA_MIN, FORE_KOLUMNER, PLATSER, SKAL, type Fore } from "@/lib/nav2/leadsforma";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar Leads, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS där de finns: att ge ett lead till någon (`tilldelaLead`,
 * med notisen och mejlet `lead-tilldelad`) och spam (`uppdateraLead`).
 *
 * DET NYA (0135): efter samtalet (Svarade inte, Pratade, Möte bokat, Ej
 * aktuell med skäl, och "Inte nu" som ett nytt samtal om tre månader), Öppna
 * igen, Fördela jämnt, Fördela automatiskt (`nav_setting` `leads.auto`),
 * Påminn (notisen `lead-paminn`), kunden när ordern lagts i Order, och Ångra
 * i tio minuter. Varje steg står i `lead_event`, med leadets läge före.
 *
 * Ordern läggs i Order (`/nav2/order`, `skapa`). Den här rutten skriver bara
 * att leadet blev den ordern.
 *
 * Mötet (beställaren 2026-10-20): ett bokat möte blir ett riktigt möte i
 * Kalendern (`skapaMote`, med säljaren som organisatör), och kunden läggs
 * till som gäst (`lead_bjud_in`, 0135). Inbjudan är Kalenderns: ett vanligt
 * mejl med kalenderfil via Resend, från säljaren. Ångra ställer in mötet
 * (`stallIn`), och kunden får då en avbokning om inbjudan hunnit gå.
 *
 * SMS finns inte: navet har ingen SMS-tjänst. Svaret säger det.
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.leads` på false svarar rutten 423 innan något skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOKAL = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/;
const KLOCKA = /^([01]\d|2[0-3]):[0-5]\d$/;
const VECKODAG = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"];

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
const forFor = (n: string) => (n || "").split(" ")[0];

type Lead = {
  id: string;
  status: string;
  status_changed_at: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  next_call_at: string | null;
  meeting_at: string | null;
  meeting_place: string | null;
  lost_reason: string | null;
  order_id: string | null;
  meeting_event_id: string | null;
  note: string | null;
  message: string | null;
  company: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
};
const KOLUMNER = "id, status, status_changed_at, assigned_to, assigned_at, next_call_at, meeting_at, meeting_place, lost_reason, order_id, meeting_event_id, note, message, company, name, email, phone";

function form(falt: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) f.set(k, v);
  return f;
}
const foreAv = (l: Lead): Fore => Object.fromEntries(FORE_KOLUMNER.map((k) => [k, l[k] ?? null])) as Fore;

/** "YYYY-MM-DD HH:MM" i svensk tid till en tidpunkt, eller null. */
function tidpunkt(v: unknown): Date | null {
  const m = LOKAL.exec(String(v ?? ""));
  if (!m) return null;
  const d = svenskTidpunkt(m[1], m[2]);
  return Number.isFinite(d.getTime()) ? d : null;
}
/** "tis 21 okt 10:00" ur en tidpunkt, för svaret. */
function nar(d: Date): string {
  const s = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d);
  const p = Object.fromEntries(s.map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${String(p.month).replace(".", "")} ${p.hour}:${p.minute}`;
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

  if (!SKRIVLAGE.leads) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const fordelar = farFordela(user);

  const hamta = async (id: unknown): Promise<Lead | null> => {
    if (!UUID.test(String(id ?? ""))) return null;
    const { data } = await db.from("lead").select(KOLUMNER).eq("id", String(id)).maybeSingle();
    return (data as unknown as Lead | null) ?? null;
  };
  const namnPa = async (id: string) => {
    const { data } = await db.from("employee").select("first_name, last_name, status").eq("id", id).maybeSingle();
    const p = data as { first_name: string; last_name: string; status: string } | null;
    return p && p.status !== "offboarded" ? fullName(p) : null;
  };
  // Säljaren som har leadet sköter det. Fördelarna kan rätta vilket som helst (som `uppdateraLead`).
  const farSkota = (l: Lead) => fordelar || l.assigned_to === mig;
  const steg = async (l: Lead, kind: string, extra: { outcome?: string; note?: string | null; till?: string | null; actor?: string | null } = {}) => {
    const { data, error } = await db
      .from("lead_event")
      .insert({ lead_id: l.id, actor_id: extra.actor === undefined ? mig : extra.actor, kind, outcome: extra.outcome ?? null, note: extra.note ?? null, till: extra.till ?? null, fore: foreAv(l) })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Steget kunde inte sparas: ${error?.message ?? "ingen rad"}`);
    return data.id as string;
  };
  const andra = async (l: Lead, falt: Partial<Lead>) => {
    const statusAndrad = falt.status !== undefined && falt.status !== l.status;
    const { error } = await db
      .from("lead")
      .update({ ...falt, ...(statusAndrad ? { status_changed_at: new Date().toISOString() } : {}) })
      .eq("id", l.id);
    if (error) throw new Error(`Leadet kunde inte sparas: ${error.message}`);
    return statusAndrad;
  };
  const klart = (ok: string, handelser: string[], extra: Record<string, unknown> = {}) => {
    revalidatePath("/leads");
    return svar({ ok, angra: handelser.length ? { handling: "angra", data: { handelser } } : null, ...extra });
  };

  // Att ge ett lead: repots tilldelaLead (notisen och mejlet), sedan steget.
  const ge = async (l: Lead, till: string, actor: string | null = mig) => {
    await tilldelaLead(form({ lead_id: l.id, assigned_to: till }));
    return steg(l, "tilldelad", { till, actor });
  };

  try {
    switch (handling) {
      case "ge": {
        if (!fordelar) return svar({ fel: "Leads fördelas av säljchef, VD och teamledare." }, 403);
        const l = await hamta(b.id);
        if (!l) return svar({ fel: "Leadet finns inte." }, 404);
        const till = String(b.till ?? "");
        const vem = UUID.test(till) ? await namnPa(till) : null;
        if (!vem) return svar({ fel: "Personen finns inte i registret." }, 400);
        if (l.assigned_to === till) return svar({ fel: `${leadTitel(l)} är redan ${forFor(vem)}s.` }, 400);
        const fore = l.assigned_to ? await namnPa(l.assigned_to) : null;
        const h = await ge(l, till);
        return klart(`${leadTitel(l)} gick till ${vem}${fore ? ` i stället för ${forFor(fore)}` : ""}. ${forFor(vem)} fick ett mejl och en notis.`, [h]);
      }

      case "jamt":
      case "auto": {
        if (!fordelar) return svar({ fel: "Leads fördelas av säljchef, VD och teamledare." }, 403);
        const plan = (Array.isArray(b.plan) ? b.plan : []).slice(0, 100) as { id?: unknown; till?: unknown }[];
        const per: Record<string, number> = {};
        const handelser: string[] = [];
        let fore: boolean | null = null;
        if (handling === "auto") {
          const { data: inst } = await db.from("nav_setting").select("value").eq("key", "leads.auto").maybeSingle();
          fore = !!(inst?.value as { pa?: boolean } | null)?.pa;
          const pa = b.pa === true;
          const { error } = await db.from("nav_setting").upsert({ key: "leads.auto", value: { pa }, updated_by: mig, updated_at: new Date().toISOString() });
          if (error) throw new Error(`Inställningen kunde inte sparas: ${error.message}`);
          await skrivHandelse({ actorId: mig, action: "lead.auto", objectType: "lead", objectId: mig, meta: { pa } });
          if (!pa) return svar({ ok: "Automatisk fördelning är av.", angra: { handling: "angra", data: { handelser: [], auto: fore } } });
        }
        for (const p of plan) {
          const l = await hamta(p.id);
          const till = String(p.till ?? "");
          if (!l || l.assigned_to || l.status !== "new" || !UUID.test(till)) continue;
          const vem = await namnPa(till);
          if (!vem) continue;
          handelser.push(await ge(l, till));
          per[vem] = (per[vem] ?? 0) + 1;
        }
        const lista = Object.entries(per).map(([n, a]) => `${forFor(n)} ${a}`);
        const och = lista.length > 1 ? `${lista.slice(0, -1).join(", ")} och ${lista[lista.length - 1]}` : lista[0] ?? "";
        if (handling === "jamt") return klart(handelser.length ? `Fördelat: ${och}.` : "Inget att fördela.", handelser);
        return klart(
          handelser.length
            ? `Automatisk fördelning är på. ${handelser.length} leads fördelades nu.`
            : "Automatisk fördelning är på. Nya leads går till den som är på plats och har minst att göra.",
          [],
          { angra: { handling: "angra", data: { handelser, auto: fore } } },
        );
      }

      case "paminn": {
        if (!fordelar) return svar({ fel: "Det är fördelarna som påminner." }, 403);
        const vem = String(b.vem ?? "");
        const namn = UUID.test(vem) ? await namnPa(vem) : null;
        if (!namn) return svar({ fel: "Personen finns inte i registret." }, 400);
        const { data } = await db.from("lead").select(KOLUMNER).eq("assigned_to", vem).eq("status", "new").is("duplicate_of", null);
        const vantar = (data ?? []) as unknown as Lead[];
        if (!vantar.length) return svar({ fel: `${forFor(namn)} har inga leads som väntar på samtal.` }, 400);
        const aldsta = vantar.reduce((a, x) => ((x.assigned_at ?? "") < (a.assigned_at ?? "") ? x : a), vantar[0]);
        await notifiera({
          till: vem,
          av: mig,
          kalla: "lead-paminn",
          typ: "lead",
          rubrik: vantar.length === 1 ? `${leadTitel(aldsta)} väntar på ett samtal` : `${vantar.length} leads väntar på samtal`,
          detalj: "Efter en timme svalnar ett lead fort.",
          href: vantar.length === 1 ? `/leads/${aldsta.id}` : "/leads",
          objekt: { typ: "lead", id: aldsta.id },
        });
        for (const l of vantar) await steg(l, "paminn", { till: vem });
        await skrivHandelse({ actorId: mig, action: "lead.reminded", objectType: "lead", objectId: aldsta.id, meta: { till: vem, antal: vantar.length } });
        return svar({ ok: `${forFor(namn)} fick en påminnelse om leads som väntar.` });
      }

      case "spam": {
        const l = await hamta(b.id);
        if (!l) return svar({ fel: "Leadet finns inte." }, 404);
        if (!farSkota(l)) return svar({ fel: "Leadet är inte ditt." }, 403);
        if (l.status === "spam") return svar({ fel: "Leadet är redan markerat som spam." }, 400);
        await uppdateraLead(form({ lead_id: l.id, status: "spam", anteckning: l.note ?? "" }));
        await andra(l, { next_call_at: null });
        const h = await steg(l, "spam");
        return klart("Markerat som spam. Det syns inte längre i listorna.", [h]);
      }

      case "oppna": {
        const l = await hamta(b.id);
        if (!l) return svar({ fel: "Leadet finns inte." }, 404);
        if (!farSkota(l)) return svar({ fel: "Leadet är inte ditt." }, 403);
        if (l.status !== "lost") return svar({ fel: "Bara ett lead som är Ej aktuell kan öppnas igen." }, 400);
        const d = tidpunkt(b.nasta);
        if (!d || d.getTime() < Date.now() || d.getTime() > Date.now() + 14 * 864e5) return svar({ fel: "Välj när du ska ringa." }, 400);
        await andra(l, { status: "contacted", next_call_at: d.toISOString(), lost_reason: null });
        const h = await steg(l, "oppnad");
        await skrivHandelse({ actorId: mig, action: "lead.status_changed", objectType: "lead", objectId: l.id, meta: { fran: l.status, till: "contacted" } });
        return klart(`Leadet är öppet igen, med ett samtal ${nar(d)}.`, [h]);
      }

      case "forsok": {
        const l = await hamta(b.id);
        if (!l) return svar({ fel: "Leadet finns inte." }, 404);
        if (!farSkota(l)) return svar({ fel: "Leadet är inte ditt." }, 403);
        if (!["new", "contacted", "meeting"].includes(l.status)) return svar({ fel: "Leadet är avslutat. Öppna det igen först." }, 400);
        const utfall = String(b.utfall ?? "");
        // K27: maskeras som i uppdateraLead. Klienten har redan sagt till om ett personnummer.
        const not = maskeraPersonnummer(String(b.not ?? "").trim()).slice(0, 1000) || null;
        const forsokNr = async () => {
          const { count } = await db.from("lead_event").select("id", { count: "exact", head: true }).eq("lead_id", l.id).eq("kind", "forsok").eq("outcome", "svar");
          return (count ?? 0) + 1;
        };
        let falt: Partial<Lead>, ok: string;
        if (utfall === "svar" || utfall === "pratade") {
          const d = tidpunkt(b.nasta);
          const max = utfall === "svar" ? 14 : 40;
          if (!d || d.getTime() < Date.now() - 5 * 60_000 || d.getTime() > Date.now() + max * 864e5) return svar({ fel: "Välj när du ska ringa igen." }, 400);
          falt = { status: "contacted", next_call_at: d.toISOString() };
          if (utfall === "svar") {
            const n = await forsokNr();
            ok = `Nästa försök ${nar(d)}.${b.sms === true ? " Inget SMS gick ut: Nav har ingen SMS-tjänst än." : ""}`;
            if (n >= 4) ok = `${n} försök utan svar. Fortsätt eller välj Ej aktuell.`;
          } else ok = `Sparat. Leadet kommer tillbaka ${nar(d)}.`;
        } else if (utfall === "mote") {
          const dag = String(b.d ?? ""), kl = String(b.s ?? ""), plats = String(b.plats ?? "");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dag) || dag < svensktDatum() || !KLOCKA.test(kl)) return svar({ fel: "Välj en dag från i dag och en tid." }, 400);
          if ([0, 6].includes(new Date(dag + "T12:00:00Z").getUTCDay())) return svar({ fel: "Det är en helgdag. Välj en vardag." }, 400);
          if (!(PLATSER as readonly string[]).includes(plats)) return svar({ fel: "Välj var mötet hålls." }, 400);
          const t = svenskTidpunkt(dag, kl);
          // Mötet i Kalendern, med säljaren som organisatör. 45 minuter, som utkastet.
          const m = await skapaMote({ rubrik: `Möte · ${leadTitel(l)}`, dag, start: Number(kl.slice(0, 2)) * 60 + Number(kl.slice(3, 5)), minuter: 45, deltagare: [], plats, agenda: l.message ?? null });
          if (m.fel || !m.eventId) return svar({ fel: m.fel ?? "Mötet kunde inte bokas i kalendern." }, 400);
          falt = { status: "meeting", next_call_at: null, meeting_at: t.toISOString(), meeting_place: plats, meeting_event_id: m.eventId };
          const nar = `${VECKODAG[new Date(dag + "T12:00:00Z").getUTCDay()]} ${+dag.slice(8)}/${+dag.slice(5, 7)} kl. ${kl}`;
          // Kunden som gäst: Kalenderns inbjudan, ett vanligt mejl med kalenderfil via Resend.
          let bjuden = false;
          if (l.email) {
            const { error } = await db.rpc("lead_bjud_in", { p_event: m.eventId, p_epost: l.email });
            bjuden = !error;
          }
          const kontakt = forFor(l.name ?? "") || "Kunden";
          ok = `Mötet ligger i kalendern ${nar}. ${l.email ? (bjuden ? `${kontakt} får en inbjudan med mejl.` : `Inbjudan till ${kontakt} kunde inte skickas. Bjud in från kalendern.`) : `${kontakt} har ingen e-postadress, så ingen inbjudan gick ut.`}`;
        } else if (utfall === "nej") {
          const skal = String(b.skal ?? "");
          if (!(SKAL as readonly string[]).includes(skal)) return svar({ fel: "Välj ett skäl." }, 400);
          if (skal === "Inte nu") {
            const d = svenskTidpunkt(new Date(Date.now() + 91 * 864e5).toISOString().slice(0, 10), "10:00");
            falt = { status: "contacted", next_call_at: d.toISOString(), lost_reason: skal };
            ok = `Nav påminner dig ${nar(d).replace(/ \d\d:\d\d$/, "")}.`;
          } else {
            falt = { status: "lost", next_call_at: null, lost_reason: skal };
            ok = "Leadet är avslutat.";
          }
        } else return svar({ fel: "Okänt utfall." }, 400);
        const statusAndrad = await andra(l, falt);
        const h = await steg(l, "forsok", { outcome: utfall, note: utfall === "nej" ? [String(b.skal), not].filter(Boolean).join(". ").slice(0, 1000) : not });
        await skrivHandelse({
          actorId: mig,
          action: statusAndrad ? "lead.status_changed" : "lead.attempt",
          objectType: "lead",
          objectId: l.id,
          meta: statusAndrad ? { fran: l.status, till: falt.status, utfall } : { utfall },
        });
        return klart(ok, [h]);
      }

      case "kund": {
        // Ordern är lagd i Order (`skapa`). Här blir leadet den ordern.
        const l = await hamta(b.id);
        if (!l) return svar({ fel: "Leadet finns inte." }, 404);
        if (!farSkota(l)) return svar({ fel: "Leadet är inte ditt." }, 403);
        const orderId = String(b.order ?? "");
        if (!UUID.test(orderId)) return svar({ fel: "Ordern finns inte." }, 400);
        const { data: o } = await db.from("sales_order").select("id, order_number, salesperson_id, created_at").eq("id", orderId).maybeSingle();
        const order = o as { id: string; order_number: number | null; salesperson_id: string | null; created_at: string } | null;
        if (!order || Date.parse(order.created_at) < Date.now() - 3600_000) return svar({ fel: "Ordern finns inte." }, 400);
        if (!fordelar && order.salesperson_id !== mig) return svar({ fel: "Ordern är inte din." }, 403);
        await andra(l, { status: "won", next_call_at: null, order_id: order.id });
        await steg(l, "kund");
        await skrivHandelse({ actorId: mig, action: "lead.status_changed", objectType: "lead", objectId: l.id, meta: { fran: l.status, till: "won", order: order.id } });
        return klart(`Leadet blev kund: order #${order.order_number}.`, []);
      }

      case "angra": {
        const ids = (Array.isArray(b.handelser) ? b.handelser : []).map(String).filter((x) => UUID.test(x)).slice(0, 100);
        const nyss = new Date(Date.now() - ANGRA_MIN * 60_000).toISOString();
        let n = 0;
        // Senast först, så att två steg på samma lead läggs tillbaka i rätt ordning.
        const { data: sr } = ids.length ? await db.from("lead_event").select("id, lead_id, at, actor_id, kind, fore").in("id", ids).order("at", { ascending: false }) : { data: [] };
        for (const s of (sr ?? []) as unknown as { id: string; lead_id: string; at: string; actor_id: string | null; kind: string; fore: Fore }[]) {
          if (s.actor_id !== mig) return svar({ fel: "Bara den som gjorde det kan ångra." }, 403);
          if (s.at < nyss) return svar({ fel: `Det går bara att ångra de första ${ANGRA_MIN} minuterna.` }, 400);
          const { data: senare } = await db.from("lead_event").select("id").eq("lead_id", s.lead_id).gt("at", s.at).neq("kind", "paminn").limit(1);
          if ((senare ?? []).length) return svar({ fel: "Något har hänt med leadet efter det. Ändra det i stället." }, 400);
          // Ett möte som steget bokade ställs in i Kalendern (kunden får en avbokning om inbjudan gått).
          const { data: nu } = await db.from("lead").select("meeting_event_id").eq("id", s.lead_id).maybeSingle();
          const mote = (nu as { meeting_event_id: string | null } | null)?.meeting_event_id ?? null;
          if (mote && mote !== (s.fore.meeting_event_id ?? null)) {
            const r = await stallIn(mote);
            if (r.fel) return svar({ fel: `Mötet kunde inte ställas in: ${r.fel}` }, 400);
          }
          const { error } = await db.from("lead").update(s.fore).eq("id", s.lead_id);
          if (error) throw new Error(`Leadet kunde inte läggas tillbaka: ${error.message}`);
          await db.from("lead_event").delete().eq("id", s.id);
          await skrivHandelse({ actorId: mig, action: "lead.undone", objectType: "lead", objectId: s.lead_id, meta: { steg: s.kind } });
          n++;
        }
        if (typeof b.auto === "boolean" && fordelar) {
          await db.from("nav_setting").upsert({ key: "leads.auto", value: { pa: b.auto }, updated_by: mig, updated_at: new Date().toISOString() });
          await skrivHandelse({ actorId: mig, action: "lead.auto", objectType: "lead", objectId: mig, meta: { pa: b.auto, angrat: true } });
        }
        revalidatePath("/leads");
        return svar({ ok: n || typeof b.auto === "boolean" ? "Ångrat." : "Inget att ångra." });
      }
    }
    return svar({ fel: "Okänd handling." }, 400);
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Det gick inte att spara." }, 400);
  }
}
