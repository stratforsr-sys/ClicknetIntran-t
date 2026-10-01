import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ical, motesflode, type Ledighet, type Mote } from "@/lib/ical";
import { fullName } from "@/lib/auth";
import { datumPlus } from "@/lib/franvaro";
import { svensktDatum } from "@/lib/klocka";

export const dynamic = "force-dynamic";

/**
 * E7.3 / AC-3.3: kalenderflödet. Hemlig URL, enkelriktat.
 *
 * ===========================================================================
 * VAD SOM INTE FINNS I DEN HÄR FILEN
 *
 * Ingen läsning av `sick_report`. Ingen frånvarotyp i svaret. Ingen POST, PUT
 * eller DELETE — enkelriktat betyder att adressen bara går att hämta ifrån.
 *
 * E1.7: offboarding ska spärra flödet. Kontrollen av ägarens `status` nedan
 * gör det automatiskt, utan att offboardingkoden behöver minnas det. Samma
 * resonemang som notisklockan i 0018: en spärr som kräver att en annan del av
 * systemet kommer ihåg att stänga den står en dag öppen.
 * ===========================================================================
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Ett kort eller uppenbart felformat värde behöver inte gå till databasen.
  if (!token || token.length < 32) return nekad();

  const db = supabaseAdmin();

  const { data: flode } = await db
    .from("calendar_feed")
    .select("id, employee_id, scope, revoked_at, read_count")
    .eq("token", token)
    .maybeSingle();

  if (!flode || flode.revoked_at) return nekad();

  const { data: agare } = await db
    .from("employee")
    .select("id, first_name, last_name, status")
    .eq("id", flode.employee_id)
    .maybeSingle();

  // E1.7. En avslutad anställd har inget flöde, oavsett vem som har adressen.
  if (!agare || agare.status === "offboarded") return nekad();

  // Leveranskalendern (0072): ägarens egna händelser, inte ledigheten.
  if (flode.scope === "handelser") {
    return handelseflode(db, flode.id, flode.read_count ?? 0, agare);
  }

  // Vilka personer flödet får bära.
  let personIds: string[] = [flode.employee_id];

  if (flode.scope === "team") {
    const [{ data: roller }, { data: direkt }, { data: team }] = await Promise.all([
      db.from("employee_role").select("role").eq("employee_id", agare.id),
      db.from("employee").select("id").eq("manager_id", agare.id).neq("status", "offboarded"),
      db.from("team").select("id").eq("lead_id", agare.id),
    ]);

    const ledning = (roller ?? []).some((r) => r.role === "sales_manager" || r.role === "ceo");

    if (ledning) {
      const { data: alla } = await db.from("employee").select("id").neq("status", "offboarded");
      personIds = (alla ?? []).map((p) => p.id);
    } else {
      const teamIds = (team ?? []).map((t) => t.id);
      const { data: iTeam } = teamIds.length
        ? await db.from("employee").select("id").in("team_id", teamIds).neq("status", "offboarded")
        : { data: [] };

      personIds = [
        ...new Set([agare.id, ...(direkt ?? []).map((p) => p.id), ...(iTeam ?? []).map((p) => p.id)]),
      ];

      // Slutar man leda folk sinar teamflödet av sig självt. Ingen ska behöva
      // komma ihåg att stänga det vid ett rollbyte.
      if (personIds.length === 1) personIds = [agare.id];
    }
  }

  // Ett år bakåt och två framåt. Ett flöde utan gräns växer varje år utan att
  // någon märker det, och ingen kalender behöver semestern från 2019.
  const idag = svensktDatum();
  const fran = datumPlus(idag, -365);
  const till = datumPlus(idag, 730);

  const { data: perioder } = await db
    .from("absence_request")
    .select("id, employee_id, starts_on, ends_on, part_day_minutes")
    .eq("status", "approved")
    .in("employee_id", personIds)
    .lte("starts_on", till)
    .gte("ends_on", fran);

  const { data: personer } = await db
    .from("employee")
    .select("id, first_name, last_name")
    .in("id", personIds);

  const namn = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));

  const poster: Ledighet[] = (perioder ?? []).map((p) => ({
    id: p.id,
    namn: namn.get(p.employee_id) ?? "Medarbetare",
    starts_on: p.starts_on,
    ends_on: p.ends_on,
    part_day_minutes: p.part_day_minutes,
  }));

  // Räknaren gör en läckt adress upptäckbar: den som ser fler hämtningar än
  // hen väntar sig kan byta adress. Det är den enda skrivning en hämtning gör.
  await db
    .from("calendar_feed")
    .update({ last_read_at: new Date().toISOString(), read_count: (flode.read_count ?? 0) + 1 })
    .eq("id", flode.id);

  const titel = flode.scope === "team" ? "Ledighet — teamet" : `Ledighet — ${fullName(agare)}`;

  return new NextResponse(ical(poster, titel), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="clicknet.ics"',
      // Adressen är hemlig. Den ska inte ligga i någon mellanliggande cache.
      "Cache-Control": "no-store, private",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/**
 * Mötesflödet (0072): de händelser ägaren organiserar eller är med på, 60 dagar
 * bakåt och ett år framåt.
 *
 * Bara rubrik, tid, plats och länk — `lk_ical_handelser()` lämnar inte ut mer.
 * Inte agendan, inte anteckningarna och inte vilka andra som är med: det är
 * navets uppgifter om kollegor, och flödet hamnar hos Google eller Microsoft.
 */
async function handelseflode(
  db: ReturnType<typeof supabaseAdmin>,
  flodeId: string,
  lasningar: number,
  agare: { id: string; first_name: string; last_name: string },
): Promise<NextResponse> {
  const idag = svensktDatum();
  const { data, error } = await db.rpc("lk_ical_handelser", {
    p_employee: agare.id,
    p_fran: datumPlus(idag, -60),
    p_till: datumPlus(idag, 365),
  });
  // Ett fel ska inte se ut som en tom kalender — då tar prenumerationen bort
  // allt. 503 och mottagaren behåller det hon hade.
  if (error) return new NextResponse(null, { status: 503, headers: { "Cache-Control": "no-store" } });

  const bas = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://clicknet-nav.vercel.app").replace(/\/+$/, "");
  const poster: Mote[] = ((data ?? []) as {
    id: string;
    title: string;
    dag: string;
    tid: string | null;
    minuter: number | null;
    starts_at: string;
    plats: string | null;
    online_url: string | null;
    ics_sequence: number;
    updated_at: string;
  }[])
    // Heldagsposter har ingen tid att visa som upptagen; de står i navet.
    .filter((h) => h.tid !== null)
    .map((h) => ({
      id: h.id,
      sekvens: h.ics_sequence,
      rubrik: h.title,
      start: new Date(h.starts_at),
      minuter: h.minuter ?? 30,
      plats: h.plats,
      url: h.online_url,
      beskrivning: `Öppna i navet: ${bas}/kalender?dag=${h.dag}&handelse=${h.id}`,
      andrad: new Date(h.updated_at),
    }));

  await db
    .from("calendar_feed")
    .update({ last_read_at: new Date().toISOString(), read_count: lasningar + 1 })
    .eq("id", flodeId);

  return new NextResponse(motesflode(poster, `Möten — ${fullName(agare)}`), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="clicknet-moten.ics"',
      "Cache-Control": "no-store, private",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/**
 * Samma svar för fel adress, återkallat flöde och avslutad anställd.
 *
 * Skillnaden mellan "finns inte" och "är stängt" berättar för den som gissar
 * att hen gissat rätt en gång. 404 och ingen kropp.
 */
function nekad(): NextResponse {
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}
