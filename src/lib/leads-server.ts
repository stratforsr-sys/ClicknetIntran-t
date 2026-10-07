import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { notifieraFlera, leadkretsen } from "@/lib/notishandelse-server";
import { skrivHandelse } from "@/lib/handelselogg-server";
import { skrivFel } from "@/lib/fel-server";
import { DUBBLETT_TIMMAR, leadTitel, tolkaInskick, type TolkatLead } from "@/lib/leads";

/**
 * Mottagningen av ett lead från hemsidan (0076).
 *
 * ===========================================================================
 * HEMLIGHETEN KAN BARA LÄMNA ETT LEAD
 *
 * `LEADS_WEBHOOK_SECRET` är en egen nyckel och inte service role, och inte
 * CRON_SECRET. Den lämnas ut till hemsidan — och därmed till hemsidans
 * hosting, dess plugins och den som en dag tar över den. Läcker den kan den
 * som hittar den skapa leads. Ingenting annat: den läser ingenting, den ändrar
 * ingenting, och den når ingen annan tabell.
 *
 * Hemligheten tas emot i adressen ELLER som `Authorization: Bearer`, av samma
 * skäl som Lynes: vi vet inte vad hemsidans formulärverktyg tillåter, och en
 * adress går alltid att klistra in.
 *
 * ===========================================================================
 * ANROPET SKA KOMMA FRÅN HEMSIDANS SERVER, INTE FRÅN BESÖKARENS WEBBLÄSARE
 *
 * Det finns med flit inga CORS-rubriker här. En hemlighet som skickas från
 * webbläsaren står i sidans källkod, och då är den ingen hemlighet. Webflows
 * och WordPress-pluginens webhookar går från deras server — det är den vägen.
 *
 * ===========================================================================
 * VAD SVARET BETYDER FÖR HEMSIDAN
 *
 *   200  leadet ligger i navet (eller var en robot, se nedan).
 *   400  kroppen gick inte att läsa. Ska inte skickas om.
 *   401  fel hemlighet.
 *   422  varken e-post eller telefon. Ska inte skickas om.
 *   429  översvämning — fler än `TAK_PER_TIMME` leads senaste timmen.
 *   500  vi kunde inte skriva. SKA skickas om.
 *   503  hemligheten är inte satt hos oss.
 *
 * En robot som fastnat i honungsfällan får 200 och `ok: true`. Ett felsvar
 * hade lärt den att fällan finns.
 * ===========================================================================
 */

const MAX_KROPP = 100_000;

/**
 * Fler leads än så på en timme är inte ett lyckat kampanjutskick, det är ett
 * formulär som en robot hittat förbi fällan. Spärren skyddar klockan och
 * inkorgarna — varje lead mejlar säljchefen och VD.
 */
export const TAK_PER_TIMME = 60;

function sammaHemlighet(given: string, vantad: string): boolean {
  // Hashas först — `timingSafeEqual` kräver lika långa buffertar, och en
  // längdkontroll före hade läckt längden. Samma som `/api/lynes/[token]`.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(vantad).digest();
  return timingSafeEqual(a, b);
}

/** `null` betyder släpp igenom. */
export function nekadForLeads(token: string | null, request: NextRequest): NextResponse | null {
  const hemlighet = process.env.LEADS_WEBHOOK_SECRET;

  // 503 och inte 401: att vi inte satt miljövariabeln är vårt driftfel.
  if (!hemlighet) return NextResponse.json({ fel: "LEADS_WEBHOOK_SECRET saknas" }, { status: 503 });

  if (token && sammaHemlighet(token, hemlighet)) return null;

  const header = request.headers.get("authorization") ?? "";
  if (header && sammaHemlighet(header, `Bearer ${hemlighet}`)) return null;

  return NextResponse.json({ fel: "Nekad" }, { status: 401 });
}

/**
 * Kroppen som ett objekt, oavsett om den kom som JSON eller som ett vanligt
 * formulär. `null` när den inte gick att läsa alls.
 */
async function lasKropp(request: NextRequest): Promise<Record<string, unknown> | null> {
  const typ = request.headers.get("content-type") ?? "";

  if (typ.includes("application/x-www-form-urlencoded") || typ.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const ut: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) {
        // En bifogad fil tas inte emot. Ett lead är text, och en fil från en
        // främling hör inte hemma i navets lagring utan en granskning.
        if (typeof v !== "string") continue;
        ut[k] = k in ut ? [ut[k], v].flat() : v;
      }
      return ut;
    } catch {
      return null;
    }
  }

  const ratext = (await request.text()).slice(0, MAX_KROPP);
  if (!ratext.trim()) return null;
  try {
    const tolkat: unknown = JSON.parse(ratext);
    return typeof tolkat === "object" && tolkat !== null && !Array.isArray(tolkat)
      ? (tolkat as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Originalet om samma kund skrivit inom ett dygn. Två frågor och inte en
 * `.or()`: en e-postadress får innehålla tecken som PostgREST:s filtersyntax
 * läser som avgränsare, och en felparsad `.or()` hittar ingenting tyst.
 *
 * Svaret pekar alltid på ett ORIGINAL — en dubblett av en dubblett pekar på
 * den första, så att listan över dubbletter hänger på ett ställe.
 */
async function hittaOriginal(lead: TolkatLead): Promise<string | null> {
  const db = supabaseAdmin();
  const sedan = new Date(Date.now() - DUBBLETT_TIMMAR * 3600_000).toISOString();

  type Traff = { id: string; duplicate_of: string | null; created_at: string };

  const forsta = async (kolumn: "email" | "phone", varde: string | null): Promise<Traff[]> => {
    if (!varde) return [];
    const { data } = await db
      .from("lead")
      .select("id, duplicate_of, created_at")
      .eq(kolumn, varde)
      .gte("created_at", sedan)
      .neq("status", "spam")
      .order("created_at")
      .limit(1);
    return (data ?? []) as unknown as Traff[];
  };

  const [viaEpost, viaTelefon] = await Promise.all([forsta("email", lead.email), forsta("phone", lead.phone)]);
  const traffar = [...viaEpost, ...viaTelefon].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const aldsta = traffar[0];
  return aldsta ? (aldsta.duplicate_of ?? aldsta.id) : null;
}

export async function taEmotLead(request: NextRequest): Promise<NextResponse> {
  const kropp = await lasKropp(request);
  if (!kropp) return NextResponse.json({ ok: false, fel: "Kroppen gick inte att läsa som JSON eller formulär." }, { status: 400 });

  const tolkning = tolkaInskick(kropp);
  if (!tolkning.ok) return NextResponse.json({ ok: false, fel: tolkning.fel }, { status: 422 });

  // Roboten får ett vanligt kvitto och ingenting sparas.
  if (tolkning.spam === "honungsfalla") return NextResponse.json({ ok: true, mottaget: true });

  const db = supabaseAdmin();
  const lead = tolkning.lead;

  try {
    const { count } = await db
      .from("lead")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) >= TAK_PER_TIMME) {
      return NextResponse.json({ ok: false, fel: "För många leads senaste timmen." }, { status: 429 });
    }

    const original = tolkning.spam ? null : await hittaOriginal(lead);
    const spam = tolkning.spam !== null;

    const { data: rad, error } = await db
      .from("lead")
      .insert({
        ...lead,
        status: spam ? "spam" : "new",
        status_changed_at: spam ? new Date().toISOString() : null,
        duplicate_of: original,
      })
      .select("id")
      .single();

    if (error || !rad) throw new Error(error?.message ?? "Ingen rad tillbaka");

    // Loggen bär aldrig kundens uppgifter — bara att något kom in och hur.
    await skrivHandelse({
      actorId: null,
      action: "lead.created",
      objectType: "lead",
      objectId: rad.id,
      meta: { kalla: lead.source, dubblett: original !== null, spam },
    });

    // En dubblett och ett spamlead stör ingen. Originalet har redan sagt till,
    // och dubbletten syns på det.
    if (!spam && !original) {
      await notifieraFlera(await leadkretsen(), {
        av: null,
        kalla: "lead-ny",
        typ: "lead",
        rubrik: `Nytt lead: ${leadTitel(lead)}`,
        detalj: [lead.name && lead.company ? lead.name : null, lead.phone ?? lead.email, lead.message]
          .filter(Boolean)
          .join(" · "),
        href: `/leads/${rad.id}`,
        objekt: { typ: "lead", id: rad.id },
      });
    }

    return NextResponse.json({ ok: true, mottaget: true, id: rad.id, dubblett: original !== null });
  } catch (e) {
    // Ingen kunduppgift i felrapporten: meddelandet från databasen kan citera
    // ett värde, och felrapporten läses av fler än leadsen.
    await skrivFel({
      kind: "automatic",
      path: "/api/leads",
      message: `Leadet kunde inte sparas: ${e instanceof Error ? e.message.slice(0, 200) : "okänt fel"}`,
    });
    return NextResponse.json({ ok: false, mottaget: false }, { status: 500 });
  }
}
