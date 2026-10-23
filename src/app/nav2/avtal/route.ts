import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { canManageEmployees, fullName, getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { notifiera } from "@/lib/notishandelse-server";
import { VARIABELNYCKLAR } from "@/lib/avtal";
import {
  draTillbakaAvtal,
  forberedAvtalsfil,
  raderaUtkast,
  registreraAvtalsfil,
  skapaAvtal,
  utfardaAvtal,
} from "@/app/(app)/avtal/actions";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";
import { vantarPaPaskrift } from "@/lib/nav2/avtalforma";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar ett anställningsavtal, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS. Nytt ur mall (`skapaAvtal`), utfärda (`utfardaAvtal`, i
 * utkastet "Skicka för påskrift"), radera utkastet (`raderaUtkast`), dra
 * tillbaka (`draTillbakaAvtal`) och bifoga en påskriven fil
 * (`forberedAvtalsfil` + `registreraAvtalsfil`, filen går direkt från
 * webbläsaren till lagringen däremellan).
 *
 * Det nya: "Påminn" om påskriften är notisen `avtal-paminnelse` till den
 * avtalet gäller, en gång om dagen. "Ta bort" raderar ett utkast och drar
 * tillbaka ett utfärdat avtal (repots regel: ett utfärdat avtal raderas inte,
 * det försvinner ur personens vy och står kvar i historiken). "Ändra till
 * tillsvidare" ändrar `employee.employment_type` med samma krets och logg som
 * repots ändringar i registret.
 *
 * Beställaren 2026-10-19: varje persons avtal och tilläggsavtal laddas upp som
 * PDF direkt i Avtal, och bara den som hanterar avtal laddar upp och tar bort.
 * Anställdas avtalskort postar också hit.
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.avtal` på false svarar rutten 423 innan något skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

function form(falt: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
}

/** Repots actions kastar vid fel och avslutar ibland med redirect(), som också kastar. Den är ett ja. */
async function kor(f: () => Promise<unknown>): Promise<{ fel?: string; till?: string }> {
  try {
    const s = (await f()) as { fel?: string } | undefined;
    return s?.fel ? { fel: s.fel } : {};
  } catch (e) {
    const d = (e as { digest?: string })?.digest;
    if (typeof d === "string" && d.startsWith("NEXT_REDIRECT")) return { till: d.split(";")[2] };
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
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

  if (!SKRIVLAGE.avtal) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  // Samma krets som `far_hantera_avtal()` i 0028.
  if (!hasRole(user, "sales_manager", "ceo", "admin")) return svar({ fel: "Bara säljchef, VD och administratör hanterar avtal." }, 403);
  const db = supabaseAdmin();

  const avtalId = String(b.avtal ?? "");
  const avtalet = async () => {
    if (!UUID.test(avtalId)) return null;
    const { data } = await db.from("contract").select("id, employee_id, title, source, status, issued_at").eq("id", avtalId).maybeSingle();
    return data;
  };

  switch (handling) {
    case "paminn": {
      const a = await avtalet();
      if (!a) return svar({ fel: "Avtalet finns inte." }, 404);
      if (a.status !== "issued" || a.source !== "template") return svar({ fel: "Avtalet väntar inte på påskrift." }, 400);
      // F1-3/B3: den påskrivna PDF:en laddas upp som ett eget avtal. Finns den, är påminnelsen onödig.
      const { data: personens } = await db.from("contract").select("employee_id, source, status, issued_at").eq("employee_id", a.employee_id as string);
      if (!vantarPaPaskrift(a as Parameters<typeof vantarPaPaskrift>[0], (personens ?? []) as Parameters<typeof vantarPaPaskrift>[1])) {
        return svar({ fel: "Det påskrivna avtalet är redan uppladdat, så ingen påminnelse behövs." }, 400);
      }
      const { data: senast } = await db.from("notification_event").select("created_at").eq("kalla", "avtal-paminnelse").eq("object_id", a.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (senast && svensktDatum(new Date(senast.created_at as string)) === svensktDatum()) return svar({ fel: "Det är redan påmint i dag." }, 409);
      const gick = await notifiera({
        till: a.employee_id as string,
        av: mig,
        kalla: "avtal-paminnelse",
        typ: "avtal",
        rubrik: "Påminnelse: skriv under ditt avtal",
        detalj: `${a.title} · ${fullName(user.employee)} väntar på det påskrivna avtalet`,
        href: `/avtal/${a.id}`,
        objekt: { typ: "contract", id: a.id },
      });
      if (!gick) return svar({ fel: "Påminnelsen gick inte att skicka." }, 500);
      return svar({ ok: "Påminnelsen är skickad. Den syns i klockan hos den avtalet gäller." });
    }

    case "tillsvidare": {
      // Registret, inte avtalet: samma krets som repots ändringar i Anställda.
      if (!canManageEmployees(user)) return svar({ fel: "Du saknar behörighet att ändra registret." }, 403);
      const vem = String(b.person ?? "");
      if (!UUID.test(vem)) return svar({ fel: "Personen finns inte." }, 404);
      const { data: p } = await db.from("employee").select("id, employment_type, removed_at").eq("id", vem).maybeSingle();
      if (!p || p.removed_at) return svar({ fel: "Personen finns inte." }, 404);
      if (p.employment_type !== "probation") return svar({ fel: "Personen är inte provanställd i registret." }, 400);
      await db.from("employee").update({ employment_type: "permanent" }).eq("id", vem);
      await db.from("audit_log").insert({ actor_id: mig, action: "employee.employment_type", object_type: "employee", object_id: vem, meta: { fran: "probation", till: "permanent" } });
      revalidatePath(`/personal/${vem}`);
      return svar({ ok: "Anställningen står nu som tillsvidare." });
    }

    case "nytt": {
      const vem = String(b.person ?? "");
      const mall = String(b.mall ?? "");
      const varden = (b.varden ?? {}) as Record<string, unknown>;
      const falt: Record<string, unknown> = { employee_id: vem, mall_id: mall };
      for (const k of VARIABELNYCKLAR) if (varden[k] !== undefined) falt[`var_${k}`] = String(varden[k]);
      const s = await kor(() => skapaAvtal({}, form(falt)));
      if (s.fel) return svar({ fel: s.fel }, 400);
      const id = s.till?.split("/").pop() ?? null;
      return svar({ ok: "Avtalet är skapat som utkast. Den det gäller ser det först när det skickas.", id });
    }

    case "utfarda": {
      const s = await kor(() => utfardaAvtal(form({ avtal_id: avtalId })));
      return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Avtalet är skickat för påskrift. Den det gäller ser det nu i Nav." });
    }

    case "radera": {
      const s = await kor(() => raderaUtkast(form({ avtal_id: avtalId })));
      return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Utkastet är raderat." });
    }

    case "ta-bort": {
      const a = await avtalet();
      if (!a) return svar({ fel: "Avtalet finns inte." }, 404);
      if (a.status === "draft") {
        const s = await kor(() => raderaUtkast(form({ avtal_id: a.id })));
        return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Utkastet är raderat." });
      }
      if (a.status !== "issued") return svar({ fel: "Avtalet är redan borttaget." }, 400);
      const skal = String(b.skal ?? "").trim().slice(0, 500);
      if (!skal) return svar({ fel: "Skriv varför avtalet tas bort. Den det gäller får skälet." }, 400);
      const s = await kor(() => draTillbakaAvtal(form({ avtal_id: a.id, skal })));
      return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Avtalet är borttaget. Den det gällde ser det inte längre och fick skälet." });
    }

    case "tillbaka": {
      const skal = String(b.skal ?? "").trim().slice(0, 500);
      if (!skal) return svar({ fel: "Skriv varför avtalet dras tillbaka." }, 400);
      const s = await kor(() => draTillbakaAvtal(form({ avtal_id: avtalId, skal })));
      return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Avtalet är tillbakadraget. Den det gällde fick ett besked med skälet." });
    }

    case "bifoga-forbered": {
      const s = await forberedAvtalsfil(String(b.person ?? ""), String(b.filnamn ?? "avtal"), String(b.mime ?? ""), Number(b.storlek ?? 0));
      return "fel" in s && s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Klar att ladda upp.", ...s, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null });
    }

    case "bifoga-registrera": {
      const s = await registreraAvtalsfil(String(b.person ?? ""), String(b.titel ?? ""), String(b.fil ?? ""), String(b.filnamn ?? "avtal"), String(b.store ?? ""));
      return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Det påskrivna avtalet är bifogat. Den det gäller ser det under Mitt avtal.", id: s.avtalId ?? null });
    }

    default:
      return svar({ fel: "Okänd handling." }, 400);
  }
}
