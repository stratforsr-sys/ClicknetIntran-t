import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { FORINSTALLNINGAR, STEG, UPPREPA, arDatum, arVy, kvittoKopierad, type Upprepa } from "@/lib/leveranskalender";
import { hamtaHandelsedetalj, lk } from "@/lib/leveranskalender-server";
import { hamtaKalposter, kalDetalj } from "@/lib/nav2/kalender";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";
import { skapaKalenderpost, stallInDelning } from "@/app/(app)/kalender/actions";
import {
  andraLangd,
  andraMote,
  flytta,
  flyttaSerie,
  foreslaTid,
  kopiera,
  sattPaminnelse,
  skapaLeverans,
  skapaMote,
  skapaSerie,
  stallIn,
  svara,
  type Resultat,
} from "@/app/(app)/kalender/moten/actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Nav 2.0: kalenderns poster när utkastet bläddrar eller visar en kollega.
 *
 *   ?vy=manad|team|vecka&dag=YYYY-MM-DD&visa=<id>,<id>   posterna, som /kalender
 *   ?detalj=<calendar_event.id>                           en händelse i sin helhet
 *
 * BARA LASNING, med samma funktioner och samma delningsnivaer som sidan
 * (`hamtaLeveranskalender`, `hamtaHandelsedetalj`).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return NextResponse.json({ fel: "Inte inloggad." }, { status: 401 });
  const url = new URL(request.url);
  const svar = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

  const detalj = url.searchParams.get("detalj");
  if (detalj) {
    if (!UUID.test(detalj)) return svar({ fel: "Okänd händelse." }, 400);
    const d = await kalDetalj(user, detalj);
    return d ? svar(d) : svar({ fel: "Händelsen finns inte, eller så får du inte se detaljerna." }, 404);
  }

  const vy = url.searchParams.get("vy");
  const dag = url.searchParams.get("dag");
  if (!arVy(vy) || !arDatum(dag)) return svar({ fel: "Okänd vy eller dag." }, 400);
  const visa = (url.searchParams.get("visa") ?? "").split(",").filter((id) => UUID.test(id));
  const data = await hamtaKalposter(user, vy, dag, visa);
  return data ? svar(data) : svar({ fel: "Ingen kalender." }, 404);
}

/**
 * Nav 2.0: allt som ändrar kalendern, i en POST.
 *
 * ===========================================================================
 * REPOTS ACTIONS. Möten, serier och 1:1 (`skapaMote`, `skapaSerie`), svar och
 * förslag, flytt, längd, inställt och kopia (app/(app)/kalender/moten), uppgift
 * och coachning i kalendern (`skapaKalenderpost`), leveransmöten från kön
 * (`skapaLeverans`) och delningen (`stallInDelning`) — samma behörighet, samma
 * utkorg och samma ångra.
 *
 * Det nya: ändra ett mötes rubrik, plats, agenda, deltagare och påminnelse
 * (`andraMote`, 0088), den egna påminnelsen (`sattPaminnelse`), "Varje månad"
 * (0089) och Privat (0090). Gäster utanför Clicknet med e-post på ett möte
 * (`lead_bjud_in`, 0135; se `gasterFran`).
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.kalender` på false svarar rutten 423 innan något
 * skrivs.
 */
const UPPREPA_FRAN: Record<string, Upprepa> = { "Upprepas inte": "aldrig", "Varje vardag": "vardagar", "Varje vecka": "vecka", "Varannan vecka": "varannan", "Varje månad": "manad" };
const STEG_FRAN: Record<string, string> = Object.fromEntries(STEG.map((s) => [FORINSTALLNINGAR[s].lab, s]));

type Falt = {
  id?: string;
  typ?: string;
  t?: string;
  d?: string;
  s?: number;
  e?: number;
  delt?: string[];
  plats?: string;
  video?: string;
  agenda?: string;
  visa?: string;
  pamin?: number | null;
  upprepa?: string;
  priv?: boolean;
  lev?: string;
  order?: string;
  heldag?: boolean;
  gaster?: string[];
};

/**
 * Gäster utanför Clicknet (beställaren 2026-10-20): "när jag lägger in ett möte
 * ska jag kunna lägga till en person, och då skickas ett vanligt mejl via
 * Resend". Samma utskick som Leads möten och Kalenderns leveransmöten:
 * `lead_bjud_in` (0135) lägger adressen i `calendar_attendee.external_email`
 * och köar `lk_ics_ko`, och utkorgen mejlar kalenderfilen från organisatören.
 * En adress som är en kollegas blir en vanlig deltagare.
 */
const EPOST = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
async function gasterFran(lista: unknown): Promise<{ epost: string[]; kolleger: string[] } | { fel: string }> {
  if (lista === undefined || lista === null) return { epost: [], kolleger: [] };
  if (!Array.isArray(lista) || lista.length > 20) return { fel: "Gästlistan stämmer inte." };
  const epost = [...new Set(lista.map((x) => String(x ?? "").trim().toLowerCase()))].filter(Boolean);
  const fel = epost.find((x) => !EPOST.test(x) || x.length > 254);
  if (fel) return { fel: `${fel} är ingen e-postadress.` };
  if (!epost.length) return { epost, kolleger: [] };
  const { data } = await supabaseAdmin().from("employee").select("id, email").in("email", epost);
  const kollega = new Map((data ?? []).map((r) => [String(r.email).toLowerCase(), String(r.id)]));
  return { epost: epost.filter((x) => !kollega.has(x)), kolleger: [...kollega.values()] };
}
const lista = (x: string[]) => (x.length > 1 ? `${x.slice(0, -1).join(", ")} och ${x[x.length - 1]}` : x[0]);
async function bjudIn(r: Resultat, eventId: string | null | undefined, epost: string[]): Promise<Resultat> {
  if (r.fel || !eventId || !epost.length) return r;
  const db = supabaseAdmin();
  const { data: fanns } = await db.from("calendar_attendee").select("external_email").eq("event_id", eventId).not("external_email", "is", null);
  const redan = new Set((fanns ?? []).map((x) => String(x.external_email).toLowerCase()));
  const fick: string[] = [];
  const inte: string[] = [];
  for (const adress of epost.filter((x) => !redan.has(x))) {
    const { error } = await db.rpc("lead_bjud_in", { p_event: eventId, p_epost: adress });
    (error ? inte : fick).push(adress);
  }
  const text = [fick.length ? `${lista(fick)} får en inbjudan med mejl.` : "", inte.length ? `Inbjudan till ${lista(inte)} gick inte att skicka.` : ""].filter(Boolean).join(" ");
  return text ? { ...r, kvitto: `${r.kvitto ?? "Sparat."} ${text}` } : r;
}

/**
 * Ctrl- eller Alt-dra (Outlook): en kopia av mötet på den dag och tid man släpper det. Repots `kopiera` lägger
 * kopian en vecka fram; att sedan flytta den hade gett deltagarna två utskick. Här blir kopian ett nytt möte med
 * samma rubrik, plats, agenda, deltagare, påminnelse, "Visa som" och Privat, och en enda inbjudan. Arrangören,
 * eller den som får planera om i arrangörens kalender, kopierar; kopian står i arrangörens kalender. Gäster
 * utanför Clicknet följer inte med, eftersom de annars fick ett mejl de inte bett om.
 */
async function kopieraTill(user: CurrentUser, id: string, dag: string, start: number): Promise<Resultat> {
  if (!UUID.test(id)) return { fel: "Händelsen finns inte längre." };
  const d = await hamtaHandelsedetalj(user, id);
  if (!d || d.installd) return { fel: "Händelsen finns inte längre." };
  if (d.slag !== "mote") return { fel: "Bara ett möte kopieras genom att dra. Ett 1:1 är en serie, och en leverans bokas från kön." };
  if (!d.farAndra) return { fel: "Bara arrangören kopierar mötet. Du kan föreslå en ny tid." };
  const db = supabaseAdmin();
  const [{ data: e }, { count: gaster }] = await Promise.all([
    db.from("calendar_event").select("show_as, is_private, online_url").eq("id", id).maybeSingle(),
    db.from("calendar_attendee").select("id", { count: "exact", head: true }).eq("event_id", id).not("external_email", "is", null),
  ]);
  const deltagare = d.deltagare.map((x) => x.id).filter((x) => x !== d.organisator);
  const r = await skapaMote({
    organisator: d.organisator,
    rubrik: d.rubrik,
    dag,
    start,
    minuter: d.minuter ?? 30,
    deltagare,
    plats: d.plats,
    agenda: d.agenda,
    paminnelse: d.paminnelse,
    visaSom: (e?.show_as as string | undefined) ?? undefined,
  });
  if (r.fel || !r.eventId) return r;
  if (e?.is_private || e?.online_url) await db.from("calendar_event").update({ is_private: Boolean(e.is_private), online_url: e.online_url ?? null }).eq("id", r.eventId);
  return { ...r, kvitto: kvittoKopierad(dag, start, deltagare.length > 0) + (gaster ? " Gästerna utanför Clicknet följer inte med." : "") };
}

const svarFran = (r: Resultat) => (r.fel ? { fel: r.fel } : { ok: r.kvitto ?? "Sparat.", angra: r.angra ?? null, id: r.eventId ?? null, dag: r.dag ?? null });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const svar2 = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  if (!user?.employee) return svar2({ fel: "Inte inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar2({ fel: "Fel ursprung." }, 403);
  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar2({ fel: "Ogiltig begäran." }, 400);
  }
  if (!SKRIVLAGE.kalender) return svar2({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const handling = String(b.handling ?? "");
  const id = String(b.id ?? "");
  const ut = (r: Resultat) => {
    const x = svarFran(r);
    return svar2(x, "fel" in x && x.fel ? 400 : 200);
  };

  try {
    switch (handling) {
      case "spara": {
        const f = (b.falt ?? {}) as Falt;
        const minuter = (f.e ?? 0) - (f.s ?? 0);
        const upprepa = UPPREPA_FRAN[f.upprepa ?? "Upprepas inte"] ?? "aldrig";
        if (!(UPPREPA as readonly string[]).includes(upprepa)) return svar2({ fel: "Välj hur det ska upprepas." }, 400);
        const deltagare = (f.delt ?? []).filter((x) => UUID.test(x));
        const g = await gasterFran(f.gaster);
        if ("fel" in g) return svar2({ fel: g.fel }, 400);
        g.kolleger.forEach((id) => deltagare.includes(id) || deltagare.push(id));
        if (g.epost.length && (f.typ === "uppgift" || f.typ === "coachning" || f.typ === "enskilt")) {
          return svar2({ fel: "Bara ett möte kan ha gäster utanför Clicknet." }, 400);
        }
        const privat = async (eventId?: string | null) => {
          if (eventId && f.priv !== undefined) await supabaseAdmin().from("calendar_event").update({ is_private: Boolean(f.priv) }).eq("id", eventId);
        };

        // Ändra ett befintligt möte: tiden med flytta/andraLangd, resten med andraMote.
        if (f.id) {
          if (!UUID.test(f.id)) return svar2({ fel: "Händelsen finns inte längre." }, 400);
          const { data: e } = await supabaseAdmin().from("calendar_event").select("dag, tid, minuter, kind").eq("id", f.id).maybeSingle();
          if (!e) return svar2({ fel: "Händelsen finns inte längre." }, 404);
          if (g.epost.length && e.kind !== "mote") return svar2({ fel: "Bara ett möte kan ha gäster utanför Clicknet." }, 400);
          const start = f.s ?? 0;
          const fore = Number(String(e.tid ?? "00:00").slice(0, 2)) * 60 + Number(String(e.tid ?? "00:00").slice(3, 5));
          let sist: Resultat = { ok: true, eventId: f.id };
          if (f.d && (f.d !== e.dag || start !== fore)) {
            sist = await flytta(f.id, f.d, start);
            if (sist.fel) return ut(sist);
          }
          if (minuter && minuter !== e.minuter) {
            sist = await andraLangd(f.id, minuter);
            if (sist.fel) return ut(sist);
          }
          if (e.kind === "mote") {
            sist = await andraMote(f.id, { rubrik: f.t ?? "", plats: f.plats ?? null, videolank: f.video ?? null, agenda: f.agenda ?? "", deltagare, paminnelse: f.pamin ?? null, visaSom: f.visa ?? null });
            if (sist.fel) return ut(sist);
          }
          await privat(f.id);
          return ut(await bjudIn(sist, sist.eventId ?? f.id, g.epost));
        }

        // Nytt.
        if (f.typ === "uppgift" || f.typ === "coachning") {
          const r = await skapaKalenderpost(
            {},
            form({ typ: f.typ, title: f.t ?? "", due_date: f.d ?? "", due_time: f.heldag ? "" : hhmm(f.s ?? 0), description_md: f.agenda ?? "", estimate_minutes: minuter || "", priority: "3", upprepas: upprepa === "aldrig" ? "" : "ja" }),
          );
          return r.fel ? svar2({ fel: r.fel }, 400) : svar2({ ok: r.ok ?? "Sparat." });
        }
        if (f.lev && f.order) {
          const steg = STEG_FRAN[f.lev];
          if (!steg) return svar2({ fel: "Välj en förinställning." }, 400);
          const r = await skapaLeverans({ orderId: f.order, steg, dag: f.d ?? "", start: f.s ?? 0, minuter: minuter || 30, deltagare, remMig: true, remKund: FORINSTALLNINGAR[steg as keyof typeof FORINSTALLNINGAR].kund });
          return ut(await bjudIn(r, r.eventId, g.epost));
        }
        if (f.typ === "enskilt" || upprepa !== "aldrig") {
          // En serie är många möten, och var och en vore ett eget mejl.
          if (g.epost.length) return svar2({ fel: "En person utanför Clicknet bjuds in till ett möte som inte upprepas." }, 400);
          const r = await skapaSerie({
            typ: f.typ === "enskilt" ? "enskilt" : "mote",
            rubrik: f.t ?? "",
            med: deltagare,
            dag: f.d ?? "",
            start: f.s ?? 0,
            minuter,
            upprepa: f.typ === "enskilt" && upprepa === "aldrig" ? "varannan" : upprepa,
            agenda: f.agenda ?? null,
            plats: f.plats ?? null,
            visaSom: f.visa,
            paminnelse: f.pamin ?? undefined,
          });
          if (!r.fel && f.priv && r.eventId) {
            const { data: e } = await supabaseAdmin().from("calendar_event").select("series_id").eq("id", r.eventId).maybeSingle();
            if (e?.series_id) await supabaseAdmin().from("calendar_event").update({ is_private: true }).eq("series_id", e.series_id);
          }
          return ut(r);
        }
        // Ett möte, också ett leveransmöte från formuläret utan kund: förinställningens rubrik och längd.
        const r = await skapaMote({ rubrik: f.t ?? "", dag: f.d ?? "", start: f.s ?? 0, minuter, deltagare, plats: f.plats ?? null, agenda: f.agenda ?? null, paminnelse: f.pamin ?? undefined, visaSom: f.visa });
        if (!r.fel) {
          await privat(r.eventId);
          if (f.video && r.eventId) await supabaseAdmin().from("calendar_event").update({ online_url: f.video }).eq("id", r.eventId);
        }
        return ut(await bjudIn(r, r.eventId, g.epost));
      }
      case "svara":
        return ut(await svara(id, String(b.svar ?? "") as "ja" | "kanske" | "nej", String(b.kommentar ?? "") || null));
      case "foresla":
        return ut(await foreslaTid(id, String(b.dag ?? ""), Number(b.start), Number(b.langd), String(b.kommentar ?? "") || null, "kanske"));
      case "stallin":
        return ut(await stallIn(id));
      case "kopiera":
        // Med dag och start: Ctrl- eller Alt-dra. Utan: "Kopiera till nästa vecka", repots kopiera.
        if (b.dag !== undefined) return ut(await kopieraTill(user, id, String(b.dag ?? ""), Number(b.start)));
        return ut(await kopiera(id));
      case "flytta": {
        const dag = String(b.dag ?? ""), start = Number(b.start);
        if (b.serie === true) return ut(await flyttaSerie(id, dag, start));
        const r = await flytta(id, dag, start);
        if (r.fel || b.langd === undefined) return ut(r);
        return ut(await andraLangd(id, Number(b.langd)));
      }
      case "langd":
        return ut(await andraLangd(id, Number(b.langd)));
      case "pamin":
        return ut(await sattPaminnelse(id, b.min === null || b.min === undefined ? null : Number(b.min)));
      case "delning": {
        const r = await stallInDelning({}, form({ employee_id: String(b.person ?? ""), level: String(b.niva ?? "") }));
        return r.fel ? svar2({ fel: r.fel }, 400) : svar2({ ok: "Delningen är sparad. Ändringen syns direkt hos dem." });
      }
      case "angra": {
        const r = await lk<{ event_id: string | null }>("lk_angra", { p_aktor: user.employee.id, p_undo: String(b.undo ?? "") });
        return r.ok ? svar2({ ok: "Ångrat. Inget skickades." }) : svar2({ fel: r.fel }, 400);
      }
      default:
        return svar2({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar2({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
