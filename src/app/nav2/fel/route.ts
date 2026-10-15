import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { skrivFel } from "@/lib/fel-server";
import { MAX_BODY } from "@/lib/fel";
import { normaliseraFel } from "@/lib/jobb/larm";
import { notifiera, notifieraFlera } from "@/lib/notishandelse-server";
import { sattStatus } from "@/app/(app)/fel/actions";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar en felrapport, i en rutt.
 *
 * ===========================================================================
 * REPOTS VÄGAR DÄR DE FINNS. En rapport skrivs med `skrivFel()`, den enda
 * vägen in i `error_report` (fel-server.ts), och status och avslut går genom
 * `sattStatus` i app/(app)/fel/actions.ts — samma behörighet, samma logg och
 * samma kvitto med ångra.
 *
 * Det nya (0082) skrivs här: vad personen pekade på, "Jag tar den", svaren i
 * tråden, "Fungerar det nu?", "Samma för mig", kända fel med råd för alla,
 * och Nav 2.0-sidans egna fel. Den som rapporterat och de som följer felet får
 * besked som händelser (`fel-meddelande`, `fel-lagad`); att någon tittar på en
 * rapport är fortfarande den härledda notisen i notiser-server.ts.
 *
 * Som i resten av navet skriver servern med service role efter egna
 * kontroller; den inloggade har bara läsrätt i databasen.
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.fel` på false svarar rutten 423 innan något annat
 * händer.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

/** Rapporten som den inloggade ser den (RLS), eller null. */
async function rapporten(id: string) {
  if (!UUID.test(id)) return null;
  const rls = await supabaseServer();
  const { data } = await rls
    .from("error_report")
    .select("id, kind, path, status, reporter_id, assigned_to, handled_by, body, message, digest, public_title")
    .eq("id", id)
    .maybeSingle();
  return data;
}

/** Ett känt fel som alla får se (0082 `kanda_fel()`), som den inloggade ser det. */
async function kantFel(id: string) {
  const rls = await supabaseServer();
  const { data } = await rls.rpc("kanda_fel");
  return ((data ?? []) as { id: string; titel: string }[]).find((k) => k.id === id) ?? null;
}

function form(falt: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) f.set(k, v);
  return f;
}

const kort = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n)}…` : t);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const mig = user.employee.id;
  // Samma krets som /fel och `sattStatus`: sales_manager, ceo och admin.
  const hanterar = hasRole(user, "sales_manager", "ceo", "admin");

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b.handling ?? "");
  const id = String(b.id ?? "");

  if (!SKRIVLAGE.fel) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const logg = (action: string, objekt: string, meta: Record<string, unknown> = {}) =>
    db.from("audit_log").insert({ actor_id: mig, action, object_type: "error_report", object_id: objekt, meta });

  try {
    switch (handling) {
      case "rapportera": {
        // Samma krav som repots rapporteraFel: en mening räcker.
        const text = String(b.text ?? "").trim();
        if (text.length < 5) return svar({ fel: "Skriv några ord om vad som hände." }, 400);
        if (text.length > MAX_BODY) return svar({ fel: "Beskrivningen är för lång. Korta ner den." }, 400);
        const ok = await skrivFel({
          kind: "manual",
          path: String(b.sida ?? "/"),
          digest: String(b.digest ?? "") || null,
          body: text,
          blocking: b.blocking === true,
          reporterId: mig,
          userAgent: request.headers.get("user-agent"),
          pointedAt: String(b.pek ?? "").trim().slice(0, 300) || null,
        });
        if (!ok) return svar({ fel: "Rapporten kunde inte sparas. Försök igen." }, 500);
        revalidatePath("/fel");
        return svar({ ok: "Tack, den är skickad." });
      }

      case "status": {
        // "Jag tittar på den", "Markera lagad" och "Öppna igen".
        if (!hanterar) return svar({ fel: "Du saknar behörighet." }, 403);
        const r = await rapporten(id);
        if (!r) return svar({ fel: "Rapporten finns inte." }, 404);
        const status = String(b.status ?? "");
        if (!["new", "ack", "closed"].includes(status)) return svar({ fel: "Okänd status." }, 400);
        const losning = String(b.losning ?? "").trim();
        if (status === "closed" && !losning) return svar({ fel: "Skriv vad som var fel." }, 400);
        await sattStatus(form({ fel_id: id, status, resolution: losning }));
        if (status === "closed") {
          // Ett nytt avslut ställer frågan "fungerar det nu?" på nytt.
          await db.from("error_report").update({ confirmed_at: null, confirmed_ok: null }).eq("id", id);
          const { data: foljare } = await db.from("error_report_follower").select("employee_id").eq("error_id", id);
          const rubrik = r.public_title ?? (r.kind === "manual" ? (r.body ?? "").split("\n")[0] : r.message?.split("\n")[0]) ?? r.path;
          // Den som rapporterade får redan den härledda "Din felrapport är avslutad".
          await notifieraFlera(
            (foljare ?? []).map((f) => f.employee_id as string).filter((x) => x !== r.reporter_id),
            { av: mig, kalla: "fel-lagad", typ: "fel", rubrik: `Lagat: ${kort(rubrik)}`, detalj: kort(losning, 200), href: "/fel", objekt: { typ: "error_report", id } },
          );
        }
        return svar({ ok: status === "closed" ? "Markerad som lagad." : status === "ack" ? "Du tittar på den." : "Öppnad igen." });
      }

      case "ta": {
        if (!hanterar) return svar({ fel: "Du saknar behörighet." }, 403);
        const r = await rapporten(id);
        if (!r) return svar({ fel: "Rapporten finns inte." }, 404);
        const nu = new Date().toISOString();
        await db
          .from("error_report")
          .update({ assigned_to: mig, handled_by: mig, handled_at: nu, ...(r.status === "new" ? { status: "ack" } : {}) })
          .eq("id", id);
        await logg("error.assigned", id);
        revalidatePath("/fel");
        return svar({ ok: "Du står som den som tar felet." });
      }

      case "svara": {
        if (!hanterar) return svar({ fel: "Du saknar behörighet." }, 403);
        const r = await rapporten(id);
        if (!r) return svar({ fel: "Rapporten finns inte." }, 404);
        const text = String(b.text ?? "").trim();
        if (!text) return svar({ fel: "Skriv något först." }, 400);
        if (text.length > 2000) return svar({ fel: "Svaret är för långt." }, 400);
        await db.from("error_report_message").insert({ error_id: id, author_id: mig, body: text });
        await db
          .from("error_report")
          .update({ handled_by: mig, handled_at: new Date().toISOString(), ...(r.status === "new" ? { status: "ack" } : {}) })
          .eq("id", id);
        await logg("error.replied", id);
        if (r.reporter_id) {
          await notifiera({ till: r.reporter_id, av: mig, kalla: "fel-meddelande", typ: "fel", rubrik: "Svar på din felrapport", detalj: kort(text, 200), href: "/fel", objekt: { typ: "error_report", id } });
        }
        return svar({ ok: "Svaret syns under Mina felrapporter." });
      }

      case "bekrafta": {
        // "Fungerar det nu?" Bara den som rapporterade, och bara på ett avslutat fel.
        const r = await rapporten(id);
        if (!r || r.reporter_id !== mig) return svar({ fel: "Bara den som rapporterade kan svara." }, 403);
        if (r.status !== "closed") return svar({ fel: "Felet är inte avslutat." }, 400);
        const ok = b.ok === true;
        const nu = new Date().toISOString();
        await db
          .from("error_report")
          .update({ confirmed_at: nu, confirmed_ok: ok, ...(ok ? {} : { status: "ack", handled_at: nu }) })
          .eq("id", id);
        if (!ok) {
          await db.from("error_report_message").insert({ error_id: id, author_id: mig, body: "Det är fortfarande trasigt." });
          const till = r.assigned_to ?? r.handled_by;
          if (till) await notifiera({ till, av: mig, kalla: "fel-meddelande", typ: "fel", rubrik: "Fortfarande trasigt", detalj: r.path, href: "/fel", objekt: { typ: "error_report", id } });
        }
        await logg(ok ? "error.confirmed" : "error.reopened", id);
        revalidatePath("/fel");
        return svar({ ok: ok ? "Tack." : "Öppnad igen." });
      }

      case "folj":
      case "slutafolja": {
        // "Samma för mig, ge mig besked" och "Jag har också det här".
        const r = (await rapporten(id)) ?? (await kantFel(id));
        if (!r) return svar({ fel: "Felet finns inte." }, 404);
        if (handling === "folj") {
          await db.from("error_report_follower").upsert({ error_id: id, employee_id: mig }, { onConflict: "error_id,employee_id" });
        } else {
          await db.from("error_report_follower").delete().eq("error_id", id).eq("employee_id", mig);
        }
        await logg(handling === "folj" ? "error.followed" : "error.unfollowed", id);
        return svar({ ok: handling === "folj" ? "Noterat. Du får besked när den är lagad." : "Borttaget." });
      }

      case "kant": {
        // Ett känt fel: rubrik och råd som alla får se. Tom text tar bort det.
        if (!hanterar) return svar({ fel: "Du saknar behörighet." }, 403);
        const r = await rapporten(id);
        if (!r) return svar({ fel: "Rapporten finns inte." }, 404);
        const titel = String(b.titel ?? "").trim().slice(0, 200);
        const rad = String(b.kant ?? "").trim().slice(0, 500);
        await db.from("error_report").update({ public_title: titel && rad ? titel : null, workaround: titel && rad ? rad : null }).eq("id", id);
        await logg("error.workaround", id, { synligt: Boolean(titel && rad) });
        return svar({ ok: titel && rad ? "Felet står under Kända fel för alla." : "Felet står inte längre under Kända fel." });
      }

      case "krasch": {
        // Nav 2.0-sidans egna fel. Samma väg som felgränsen, med meddelandet:
        // skrivFel maskerar och klipper, och digesten är stabil över gånger.
        const message = String(b.message ?? "").slice(0, 2000);
        const digest = `nav2-${createHash("sha1").update(normaliseraFel(message)).digest("hex").slice(0, 12)}`;
        await skrivFel({
          kind: "automatic",
          path: String(b.sida ?? "/nav2"),
          digest,
          message,
          stack: String(b.stack ?? "").slice(0, 8000) || null,
          reporterId: mig,
          userAgent: request.headers.get("user-agent"),
        });
        return svar({ ok: "Skickat.", digest });
      }

      case "beskriv": {
        // "Beskriv vad du gjorde" på felsidan: på samma rad som felet Nav fångade.
        const text = String(b.text ?? "").trim();
        if (text.length < 3) return svar({ fel: "Skriv några ord." }, 400);
        const { data: rad } = await db
          .from("error_report")
          .select("id")
          .eq("kind", "automatic")
          .eq("digest", String(b.digest ?? ""))
          .eq("path", String(b.sida ?? "/nav2"))
          .maybeSingle();
        if (!rad) return svar({ fel: "Felet hittades inte. Skriv en rapport i stället." }, 404);
        await db.from("error_report_message").insert({ error_id: rad.id, author_id: mig, body: text.slice(0, 2000) });
        await db.from("error_report_follower").upsert({ error_id: rad.id, employee_id: mig }, { onConflict: "error_id,employee_id" });
        return svar({ ok: "Tack. Beskrivningen hamnar på samma rad som felet Nav fångade." });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
