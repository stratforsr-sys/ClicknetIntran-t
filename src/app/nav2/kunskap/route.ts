import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pdfText } from "@/lib/pdf";
import { nivaFor } from "@/lib/nav2/forma";
import { FIL_MAX_BYTES, delaIStycken, farSkotaKunskap, filsort, grupperaMissar, provaDokument, titelUrFil } from "@/lib/nav2/kunskapforma";
import { medNyckel } from "@/lib/nav2/nyckel";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: kunskapsbasen i Inställningar (0312, PRD:n 2026-11-16).
 *
 * GET            Listan över dokumenten och det chatten sökt utan att hitta.
 * GET ?id=…      Ett dokument med hela texten, för att ändra det.
 *
 * POST, `handling`:
 *   lagg           Ett nytt dokument ur skriven eller inklistrad text (titel, omrade, text, filnamn).
 *   fil            Ett nytt dokument ur en fil (namn, data i base64): PDF, text eller Markdown. Filen sparas inte, bara texten.
 *   andra          Titel, område och text på ett dokument.
 *   ta_bort        Tar bort ett dokument. Svaret bär dokumentet, så att Ångra kan lägga tillbaka det.
 *   miss_stryk     Stryker en sökning ur listan över det som saknas. Svaret bär tidpunkterna, för Ångra.
 *   miss_tillbaka  Lägger tillbaka en struken sökning.
 *
 * BARA den som sköter företagets inställningar (admin och uppåt) når rutten. Alla anställda läser dokumenten
 * genom chatten, som den inloggade (RLS). Varje skrivning bokförs i händelseloggen med vem, vad och när.
 *
 * Texten i ett dokument är data. Den blir aldrig en instruktion till chatten (systemtexten, "Text utifrån").
 *
 * LÄSLÄGE: står `SKRIVLAGE.kunskap` på false svarar POST 423 innan något skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Så många sökningar utan svar läses till listan, de senaste först. */
const MISSAR_MAX = 500;

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

async function behorig() {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: svar({ fel: "Du måste vara inloggad." }, 401) } as const;
  if (!farSkotaKunskap(nivaFor(user.roles))) return { fel: svar({ fel: "Kunskapsbasen sköts av den som får ändra företagets inställningar." }, 403) } as const;
  return { mig: user.employee.id } as const;
}

type Rad = { id: string; titel: string; omrade: string; filnamn: string | null; andrad: string };

export async function GET(request: Request) {
  const b = await behorig();
  if ("fel" in b) return b.fel;
  const db = supabaseAdmin();
  const id = new URL(request.url).searchParams.get("id");
  try {
    if (id) {
      if (!UUID.test(id)) return svar({ fel: "Okänt dokument." }, 400);
      const { data, error } = await db.from("kunskap_dokument").select("id, titel, omrade, filnamn, text, andrad").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? svar({ dokument: data }) : svar({ fel: "Dokumentet finns inte längre." }, 404);
    }
    const [dok, stycken, miss] = await Promise.all([
      db.from("kunskap_dokument").select("id, titel, omrade, filnamn, andrad").order("omrade").order("titel").limit(1000),
      db.from("kunskap_stycke").select("dokument").limit(20000),
      db.from("kunskap_miss").select("sokord, nar").order("nar", { ascending: false }).limit(MISSAR_MAX),
    ]);
    const e = dok.error ?? stycken.error ?? miss.error;
    if (e) throw new Error(e.message);
    const antal = new Map<string, number>();
    for (const s of (stycken.data ?? []) as { dokument: string }[]) antal.set(s.dokument, (antal.get(s.dokument) ?? 0) + 1);
    return svar({
      dokument: ((dok.data ?? []) as Rad[]).map((d) => ({ ...d, stycken: antal.get(d.id) ?? 0 })),
      saknas: grupperaMissar((miss.data ?? []) as { sokord: string; nar: string }[]),
      skriv: SKRIVLAGE.kunskap,
    });
  } catch {
    return svar({ fel: "Kunskapsbasen gick inte att läsa." }, 500);
  }
}

export async function POST(request: Request) {
  const beh = await behorig();
  if ("fel" in beh) return beh.fel;
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  if (!SKRIVLAGE.kunskap) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const mig = beh.mig;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const db = supabaseAdmin();
  const logga = (action: string, id: string, meta: Record<string, unknown>) => db.from("audit_log").insert({ actor_id: mig, action, object_type: "kunskap_dokument", object_id: id, meta });

  /** Sparar dokumentet och dess stycken i en transaktion (`kunskap_spara`). */
  const spara = async (id: string | null, falt: { titel: string; omrade: string; text: string }, filnamn: string | null) => {
    const stycken = delaIStycken(falt.text);
    if (!stycken.length) return svar({ fel: "Dokumentet har ingen text under rubrikerna." }, 400);
    const { data, error } = await db.rpc("kunskap_spara", { p_id: id, p_titel: falt.titel, p_omrade: falt.omrade, p_filnamn: filnamn, p_text: falt.text, p_av: mig, p_stycken: stycken });
    if (error) return svar({ fel: "Dokumentet kunde inte sparas." }, 500);
    if (!data) return svar({ fel: "Dokumentet finns inte längre." }, 404);
    await logga(id ? "kunskap.changed" : "kunskap.added", String(data), { titel: falt.titel, stycken: stycken.length, ...(filnamn && !id ? { filnamn } : {}) });
    return svar({ ok: id ? "Sparat." : "Dokumentet ligger i kunskapsbasen.", id: String(data), titel: falt.titel, stycken: stycken.length });
  };

  try {
    switch (String(b.handling ?? "")) {
      case "lagg": {
        const p = provaDokument(b);
        if (!p.ok) return svar({ fel: p.fel }, 400);
        const filnamn = typeof b.filnamn === "string" && b.filnamn.trim() ? b.filnamn.trim().slice(0, 200) : null;
        return medNyckel(request, mig, () => spara(null, p.falt, filnamn));
      }

      case "fil": {
        const namn = String(b.namn ?? "").trim().slice(0, 200);
        const sort = filsort(namn);
        if (!sort) return svar({ fel: "Kunskapsbasen läser PDF, text (.txt) och Markdown (.md)." }, 400);
        const data = typeof b.data === "string" ? b.data : "";
        if (!data || data.length > Math.ceil(FIL_MAX_BYTES / 3) * 4) return svar({ fel: "Filen är tom eller för stor. Högst 3 MB." }, 400);
        const bytes = Buffer.from(data, "base64");
        if (!bytes.length || bytes.length > FIL_MAX_BYTES) return svar({ fel: "Filen är tom eller för stor. Högst 3 MB." }, 400);
        const text = sort === ".pdf" ? await pdfText(new Uint8Array(bytes)) : new TextDecoder("utf-8").decode(bytes);
        if (!text || !text.trim()) return svar({ fel: sort === ".pdf" ? "PDF:en har ingen text som går att läsa. Är den inskannad som bild? Klistra in texten i stället." : "Filen har ingen text." }, 400);
        const p = provaDokument({ titel: titelUrFil(namn), omrade: b.omrade, text });
        if (!p.ok) return svar({ fel: p.fel }, 400);
        return medNyckel(request, mig, () => spara(null, p.falt, namn));
      }

      case "andra": {
        const id = String(b.id ?? "");
        if (!UUID.test(id)) return svar({ fel: "Okänt dokument." }, 400);
        const p = provaDokument(b);
        if (!p.ok) return svar({ fel: p.fel }, 400);
        return spara(id, p.falt, null);
      }

      case "ta_bort": {
        const id = String(b.id ?? "");
        if (!UUID.test(id)) return svar({ fel: "Okänt dokument." }, 400);
        const { data, error } = await db.from("kunskap_dokument").delete().eq("id", id).select("titel, omrade, filnamn, text").maybeSingle();
        if (error) return svar({ fel: "Dokumentet kunde inte tas bort." }, 500);
        if (!data) return svar({ fel: "Dokumentet finns inte längre." }, 404);
        const d = data as { titel: string; omrade: string; filnamn: string | null; text: string };
        await logga("kunskap.removed", id, { titel: d.titel });
        return svar({ ok: "Dokumentet är borttaget.", borttaget: d });
      }

      case "miss_stryk": {
        const sokord = String(b.sokord ?? "").trim();
        if (sokord.length < 2 || sokord.length > 200) return svar({ fel: "Okänd sökning." }, 400);
        // Samma rader som listan visar: de senaste, och samma sökning oavsett stor och liten bokstav.
        const { data: alla, error: lasfel } = await db.from("kunskap_miss").select("id, sokord, nar").order("nar", { ascending: false }).limit(MISSAR_MAX);
        if (lasfel) return svar({ fel: "Sökningen kunde inte strykas." }, 500);
        const mina = ((alla ?? []) as { id: number; sokord: string; nar: string }[]).filter((r) => r.sokord.trim().toLowerCase() === sokord.toLowerCase());
        if (!mina.length) return svar({ fel: "Sökningen står inte kvar i listan." }, 404);
        const { error } = await db.from("kunskap_miss").delete().in("id", mina.map((r) => r.id));
        if (error) return svar({ fel: "Sökningen kunde inte strykas." }, 500);
        return svar({ ok: "Struken.", strukna: mina.map((r) => ({ sokord: r.sokord, nar: r.nar })) });
      }

      case "miss_tillbaka": {
        const rader = (Array.isArray(b.rader) ? (b.rader as { sokord?: unknown; nar?: unknown }[]) : []).slice(0, MISSAR_MAX)
          .map((r) => ({ sokord: String(r?.sokord ?? "").trim(), nar: new Date(String(r?.nar ?? "")) }))
          .filter((r) => r.sokord.length >= 2 && r.sokord.length <= 200 && !Number.isNaN(r.nar.getTime()) && r.nar.getTime() <= Date.now());
        if (!rader.length) return svar({ fel: "Inget att lägga tillbaka." }, 400);
        const { error } = await db.from("kunskap_miss").insert(rader.map((r) => ({ sokord: r.sokord, nar: r.nar.toISOString() })));
        if (error) return svar({ fel: "Sökningen kunde inte läggas tillbaka." }, 500);
        return svar({ ok: "Tillbaka i listan." });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch {
    return svar({ fel: "Något gick fel." }, 500);
  }
}
