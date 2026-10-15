import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { frist } from "@/lib/arenden";
import { notifiera } from "@/lib/notishandelse-server";
import { andraStatus, svara, tilldela } from "@/app/(app)/arenden/actions";
import { bucketen, huvudUppgifter, lagerForNyaFiler, signeraLank, signeraUppladdning } from "@/lib/lagring-server";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar ett ärende, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS DÄR DE FINNS. Svara, status, lösning och handläggare går
 * genom `svara`, `andraStatus` och `tilldela` i app/(app)/arenden/actions.ts —
 * samma kontroller, samma logg, samma notiser. Att skapa ett ärende speglar
 * `skapaArende` (som slutar med en omdirigering) och lägger till det Nav 2.0
 * har: kopplingar och att chefen lägger upp ett ärende åt någon.
 *
 * Det nya (0081) skrivs här: läskvitto, "löste det?", påminnelser,
 * kopplingar, bilagor och vad ärenden lett till.
 *
 * Som i resten av navet skriver servern med service role efter egna
 * kontroller; den inloggade har bara läsrätt i databasen.
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.arenden` på false svarar rutten 423 innan något
 * annat händer. Läsningen av en bilaga (`handling: "visa"`) är ingen skrivning
 * och fungerar alltid.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_BYTE = 10 * 1024 * 1024;

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

/** Ärendet som den inloggade ser det (RLS), eller null. */
async function arendet(id: string) {
  if (!UUID.test(id)) return null;
  const rls = await supabaseServer();
  const { data } = await rls
    .from("hr_case")
    .select("id, employee_id, assigned_to, confidential, status, subject, sla_hours, resolved_at")
    .eq("id", id)
    .maybeSingle();
  return data;
}

function form(falt: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) f.set(k, v);
  return f;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const mig = user.employee.id;
  const hanterare = hasRole(user, "sales_manager", "ceo");

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b.handling ?? "");
  const id = String(b.id ?? "");

  // En bilaga visas alltid: det är en läsning, och den loggas inte som en ändring.
  if (handling === "visa") {
    const a = await arendet(String(b.arende ?? ""));
    if (!a) return svar({ fel: "Ärendet finns inte." }, 404);
    const { data: fil } = await supabaseAdmin().from("hr_case_attachment").select("store, bucket, path, filename").eq("id", id).eq("case_id", a.id).maybeSingle();
    if (!fil) return svar({ fel: "Bilagan finns inte." }, 404);
    const l = await signeraLank({ lager: fil.store, bucket: fil.bucket, path: fil.path, sekunder: 60, laddaNedSom: null });
    return "url" in l ? svar({ url: l.url }) : svar({ fel: l.fel }, 500);
  }

  if (!SKRIVLAGE.arenden) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();

  try {
    switch (handling) {
      case "skapa": {
        const kategori = String(b.kategori ?? "");
        const rubrik = String(b.rubrik ?? "").trim();
        const text = String(b.text ?? "").trim();
        const konf = b.konfidentiellt === true;
        if (!rubrik) return svar({ fel: "Skriv en rubrik." }, 400);
        if (text.length < 5) return svar({ fel: "Beskriv ärendet med några ord." }, 400);
        // Chefen kan lägga upp ett ärende åt någon som ringde eller kom förbi.
        const at = String(b.at ?? "");
        if (at && !hanterare) return svar({ fel: "Bara säljchef och VD kan lägga upp ett ärende åt någon." }, 403);
        const agare = at && UUID.test(at) ? at : mig;
        const { data: kat } = await db.from("case_category").select("id, sla_hours").eq("id", kategori).maybeSingle();
        if (!kat) return svar({ fel: "Välj en kategori." }, 400);
        const { data: rad, error } = await db
          .from("hr_case")
          .insert({ employee_id: agare, created_by: mig, category: kat.id, subject: rubrik, confidential: konf, sla_hours: kat.sla_hours, due_at: frist(new Date(), kat.sla_hours) })
          .select("id, due_at")
          .single();
        if (error || !rad) return svar({ fel: `Ärendet kunde inte skapas: ${error?.message ?? "okänt fel"}` }, 500);
        await db.from("case_message").insert({ case_id: rad.id, author_id: mig, body: text });
        const kopplingar = Array.isArray(b.kontext) ? (b.kontext as { kind: string; ref: string; label: string }[]) : [];
        for (const k of kopplingar.slice(0, 5)) {
          if (["order", "provision", "calendar_event"].includes(k.kind) && k.ref && k.label) {
            await db.from("hr_case_link").insert({ case_id: rad.id, kind: k.kind, ref: String(k.ref), label: String(k.label), created_by: mig });
          }
        }
        await db.from("audit_log").insert({ actor_id: mig, action: "case.created", object_type: "hr_case", object_id: rad.id, meta: { kategori: kat.id, konfidentiellt: konf, at: agare !== mig ? agare : null } });
        revalidatePath("/arenden");
        return svar({ ok: "Ärendet är skickat.", id: rad.id, due: rad.due_at });
      }
      case "svara": {
        const a = await arendet(id);
        if (!a) return svar({ fel: "Ärendet finns inte, eller så är det inte ditt." }, 404);
        await svara(form({ arende_id: id, text: String(b.text ?? "") }));
        return svar({ ok: "Skickat." });
      }
      case "status":
      case "los": {
        if (!hanterare) return svar({ fel: "Du saknar behörighet." }, 403);
        const status = handling === "los" ? "resolved" : String(b.status ?? "");
        if (handling === "los" && !String(b.losning ?? "").trim()) return svar({ fel: "Skriv vad lösningen blev." }, 400);
        await andraStatus(form({ arende_id: id, status, losning: String(b.losning ?? "") }));
        return svar({ ok: handling === "los" ? "Löst." : "Statusen är ändrad." });
      }
      case "tilldela": {
        if (!hanterare) return svar({ fel: "Du saknar behörighet." }, 403);
        const a = await arendet(id);
        if (!a) return svar({ fel: "Ärendet finns inte." }, 404);
        if (a.confidential) return svar({ fel: "Ett konfidentiellt ärende kan inte lämnas vidare." }, 400);
        await tilldela(form({ arende_id: id, assigned_to: String(b.till ?? "") }));
        return svar({ ok: "Ärendet har en ny handläggare." });
      }
      case "last":
      case "olast": {
        const a = await arendet(id);
        if (!a) return svar({ fel: "Ärendet finns inte." }, 404);
        if (handling === "last") await db.from("hr_case_read").upsert({ case_id: id, employee_id: mig, read_at: new Date().toISOString() });
        else await db.from("hr_case_read").delete().eq("case_id", id).eq("employee_id", mig);
        return svar({ ok: handling === "last" ? "Läst." : "Markerat som oläst." });
      }
      case "bekrafta": {
        const a = await arendet(id);
        if (!a || a.employee_id !== mig) return svar({ fel: "Bara den ärendet gäller kan svara." }, 403);
        if (!a.resolved_at) return svar({ fel: "Ärendet är inte löst." }, 400);
        const lost = b.lost === true;
        await db.from("hr_case_confirmation").upsert({ case_id: id, solved: lost, note: String(b.note ?? "").trim() || null, confirmed_by: mig, confirmed_at: new Date().toISOString() });
        if (!lost) {
          // Nej: ärendet öppnas igen med ett nytt löfte, och handläggaren får veta det.
          await db.from("hr_case").update({ status: "in_progress", resolved_at: null, due_at: frist(new Date(), a.sla_hours) }).eq("id", id);
          await db.from("case_message").insert({ case_id: id, author_id: mig, body: String(b.note ?? "").trim() || "Det här löste inte riktigt mitt ärende." });
          const till = a.assigned_to ?? null;
          if (till) await notifiera({ till, av: mig, kalla: "arende-status", typ: "arende", rubrik: `Öppnat igen: ${a.subject}`, detalj: "Det löste inte ärendet", href: `/arenden/${id}`, objekt: { typ: "hr_case", id } });
        }
        await db.from("audit_log").insert({ actor_id: mig, action: lost ? "case.confirmed" : "case.reopened", object_type: "hr_case", object_id: id, meta: {} });
        revalidatePath(`/arenden/${id}`);
        return svar({ ok: lost ? "Tack." : "Öppnat igen." });
      }
      case "paminn": {
        if (!hanterare) return svar({ fel: "Du saknar behörighet." }, 403);
        const a = await arendet(id);
        if (!a) return svar({ fel: "Ärendet finns inte." }, 404);
        await db.from("hr_case_reminder").insert({ case_id: id, sent_by: mig });
        await notifiera({ till: a.employee_id, av: mig, kalla: "arende-status", typ: "arende", rubrik: `Påminnelse: ${a.subject}`, detalj: "Ärendet väntar på ditt svar", href: `/arenden/${id}`, objekt: { typ: "hr_case", id } });
        return svar({ ok: "Påmind." });
      }
      case "koppla": {
        const a = await arendet(id);
        if (!a) return svar({ fel: "Ärendet finns inte." }, 404);
        const kind = String(b.kind ?? "");
        if (!["order", "provision", "calendar_event"].includes(kind)) return svar({ fel: "Okänd koppling." }, 400);
        await db.from("hr_case_link").upsert({ case_id: id, kind, ref: String(b.ref ?? ""), label: String(b.label ?? ""), created_by: mig }, { onConflict: "case_id,kind,ref" });
        return svar({ ok: "Kopplat." });
      }
      case "utfall": {
        if (!hanterare) return svar({ fel: "Du saknar behörighet." }, 403);
        const fraga = String(b.fraga ?? "").trim();
        const utfall = String(b.utfall ?? "").trim();
        if (!fraga || !utfall) return svar({ fel: "Skriv både frågan och vad den ledde till." }, 400);
        await db.from("case_outcome").insert({ case_id: UUID.test(id) ? id : null, fraga, utfall, created_by: mig });
        return svar({ ok: "Tillagt." });
      }
      case "bilaga-forbered": {
        const a = await arendet(id);
        if (!a) return svar({ fel: "Ärendet finns inte." }, 404);
        const mime = String(b.mime ?? "");
        const storlek = Number(b.storlek ?? 0);
        if (!MIME.has(mime)) return svar({ fel: "Bara PDF, JPEG och PNG." }, 400);
        if (!(storlek > 0 && storlek <= MAX_BYTE)) return svar({ fel: "Filen får vara högst 10 MB." }, 400);
        const lager = lagerForNyaFiler();
        const bucket = bucketen(lager);
        const filId = crypto.randomUUID();
        const path = `arenden/${id}/${filId}`;
        const s = await signeraUppladdning({ lager, bucket, path, mime, sekunder: 300 });
        if ("fel" in s) return svar({ fel: s.fel }, 500);
        return svar({ ok: "Klar att ladda upp.", lager, bucket, path, filId, ...s });
      }
      case "bilaga-registrera": {
        const a = await arendet(id);
        if (!a) return svar({ fel: "Ärendet finns inte." }, 404);
        const lager = String(b.lager ?? "") as "supabase" | "r2";
        const bucket = String(b.bucket ?? "");
        const path = String(b.path ?? "");
        const filId = String(b.filId ?? "");
        if (!path.startsWith(`arenden/${id}/`) || bucket !== bucketen(lager)) return svar({ fel: "Fel sökväg." }, 400);
        // Lagringens egna uppgifter, inte klientens: storlek och typ provas här.
        const h = await huvudUppgifter({ lager, bucket, path, mapp: `arenden/${id}`, fileId: filId });
        if (!h || !MIME.has(h.mime) || !(h.storlek > 0 && h.storlek <= MAX_BYTE)) return svar({ fel: "Filen kom inte fram, eller är av fel sort." }, 400);
        const { data: rad, error } = await db
          .from("hr_case_attachment")
          .insert({ case_id: id, store: lager, bucket, path, filename: String(b.filnamn ?? "bilaga").slice(0, 200), mime_type: h.mime, size_bytes: h.storlek, uploaded_by: mig })
          .select("id")
          .single();
        if (error || !rad) return svar({ fel: error?.message ?? "Bilagan kunde inte sparas." }, 500);
        return svar({ ok: "Bilagan är sparad.", bilaga: rad.id });
      }
      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
