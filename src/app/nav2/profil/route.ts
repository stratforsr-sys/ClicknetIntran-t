import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { bildAdress } from "@/lib/nav2/profil";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: profilen i Inställningar (0107). Bara den egna profilen.
 *
 *   konto      Tilltalsnamn, telefon och privat mejl. Telefonen och mejlet är
 *              samma fält som Anställda visar (0105); ändringen står i
 *              personens historik där, som i utkastet.
 *   bild       En ny profilbild: 256 × 256 JPEG som data-URL, beskuren i
 *              webbläsaren. Den förra sparas för Ångra.
 *   bild-bort  Ta bort bilden. Den sparas för Ångra.
 *   bild-angra Byt tillbaka till bilden före (och igen, åt andra hållet).
 *
 * GET ?bild=<anställds id> är bilden, för alla inloggade (policyn i 0107).
 * Adressen bär `v` = när bilden byttes, så den cachas länge i webbläsaren.
 *
 * LÄSLÄGE: står `SKRIVLAGE.profil` på false svarar POST 423 innan något skrivs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PNR = /\d{6}[-+]?\d{4}/;
const EPOST = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

// Samma regel som utkastets prfTelNorm: +46 och 0046 blir 0, sedan bara siffror.
function telNorm(v: string): string {
  let d = v.replace(/[^\d+]/g, "");
  if (d.startsWith("+46")) d = "0" + d.slice(3);
  else if (d.startsWith("0046")) d = "0" + d.slice(4);
  return d.replace(/\D/g, "");
}

// Bytea till och från PostgREST: hex med \x först.
const tillHex = (b: Buffer) => "\\x" + b.toString("hex");
const franHex = (s: unknown): Buffer | null => (typeof s === "string" && s.startsWith("\\x") ? Buffer.from(s.slice(2), "hex") : null);

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  const id = new URL(request.url).searchParams.get("bild") ?? "";
  if (!UUID.test(id)) return svar({ fel: "Okänd läsning." }, 400);
  const supabase = await supabaseServer();
  const { data } = await supabase.from("employee_photo").select("image").eq("employee_id", id).maybeSingle();
  const bild = franHex(data?.image);
  if (!bild) return svar({ fel: "Ingen bild." }, 404);
  return new NextResponse(new Uint8Array(bild), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
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

  if (!SKRIVLAGE.profil) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();
  const nu = new Date().toISOString();

  const lasBild = async () => {
    const { data, error } = await db.from("employee_photo").select("image, previous").eq("employee_id", mig).maybeSingle();
    return { image: franHex(data?.image), previous: franHex(data?.previous), error };
  };
  const sparaBild = async (image: Buffer | null, previous: Buffer | null) => {
    const { error } = await db
      .from("employee_photo")
      .upsert({ employee_id: mig, image: image ? tillHex(image) : null, previous: previous ? tillHex(previous) : null, updated_by: mig, updated_at: nu }, { onConflict: "employee_id" });
    return !error;
  };

  try {
    switch (handling) {
      case "konto": {
        const tilltal = String(b.tilltal ?? "").trim();
        const tel = String(b.tel ?? "").trim();
        const privat = String(b.privat ?? "").trim();
        if (!tilltal) return svar({ fel: "Skriv vad Nav ska kalla dig, till exempel ditt förnamn." }, 400);
        if (tilltal.length > 30) return svar({ fel: "Tilltalsnamnet får vara högst 30 tecken." }, 400);
        if (PNR.test(tilltal) || PNR.test(tel) || PNR.test(privat)) return svar({ fel: "Ett personnummer hör inte hemma här." }, 400);
        if (tel && (tel.length > 40 || !/^0\d{7,9}$/.test(telNorm(tel)))) return svar({ fel: "Skriv numret med 8 till 10 siffror." }, 400);
        if (privat && (privat.length > 200 || !EPOST.test(privat))) return svar({ fel: "Skriv hela adressen, till exempel namn@exempel.se." }, 400);
        if (privat && /@clicknet\.se$/i.test(privat)) return svar({ fel: "Det är en jobbadress. Skriv en privat adress." }, 400);

        const { data: fore, error: lasFel } = await db.from("employee_onboarding").select("preferred_name, phone, private_email").eq("employee_id", mig).maybeSingle();
        if (lasFel) return svar({ fel: "Profilen sparas när navet har fått tilltalsnamnet (0107). Ingenting ändrades." }, 503);
        // Samma som förnamnet i registret = inget eget tilltalsnamn, så att ett namnbyte i Anställda slår igenom.
        const eget = tilltal === user.employee.first_name.trim() ? null : tilltal;
        const ny = { preferred_name: eget, phone: tel || null, private_email: privat || null };
        const forut = { preferred_name: (fore?.preferred_name as string | null) ?? null, phone: (fore?.phone as string | null) ?? null, private_email: (fore?.private_email as string | null) ?? null };
        const vad = [
          (ny.preferred_name ?? "") !== (forut.preferred_name ?? "") && "tilltalsnamn",
          (ny.phone ?? "") !== (forut.phone ?? "") && "telefonnummer",
          (ny.private_email ?? "") !== (forut.private_email ?? "") && "privat mejl",
        ].filter((v): v is string => !!v);
        if (!vad.length) return svar({ ok: "" });
        const { error } = await db.from("employee_onboarding").upsert({ employee_id: mig, ...ny, updated_by: mig, updated_at: nu }, { onConflict: "employee_id" });
        if (error) return svar({ fel: "Det gick inte att spara." }, 500);
        const och = vad.length > 1 ? `${vad.slice(0, -1).join(", ")} och ${vad[vad.length - 1]}` : vad[0];
        // Personens historik i Anställda (formaHandelse sätter namnet först).
        await db.from("audit_log").insert({ actor_id: mig, action: "anstallda.handelse", object_type: "employee", object_id: mig, meta: { text: `ändrade sitt ${och} i inställningarna.`, falt: vad } });
        return svar({ ok: "" });
      }

      case "bild": {
        const data = String(b.data ?? "");
        const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(data);
        const bild = m ? Buffer.from(m[1], "base64") : null;
        if (!bild || bild.length < 100 || bild.length > 200000 || bild[0] !== 0xff || bild[1] !== 0xd8 || bild[2] !== 0xff)
          return svar({ fel: "Bilden gick inte att läsa. Välj en annan bild." }, 400);
        const nuv = await lasBild();
        if (nuv.error) return svar({ fel: "Profilbilden sparas när navet har fått profilbilderna (0107). Ingenting ändrades." }, 503);
        if (!(await sparaBild(bild, nuv.image))) return svar({ fel: "Det gick inte att spara." }, 500);
        return svar({ ok: "", url: bildAdress(mig, nu) });
      }

      case "bild-bort": {
        const nuv = await lasBild();
        if (nuv.error) return svar({ fel: "Det gick inte att spara." }, 500);
        if (!nuv.image) return svar({ ok: "", url: null });
        if (!(await sparaBild(null, nuv.image))) return svar({ fel: "Det gick inte att spara." }, 500);
        return svar({ ok: "", url: null });
      }

      case "bild-angra": {
        const nuv = await lasBild();
        if (nuv.error) return svar({ fel: "Det gick inte att spara." }, 500);
        if (!nuv.previous && !nuv.image) return svar({ ok: "", url: null });
        if (!(await sparaBild(nuv.previous, nuv.image))) return svar({ fel: "Det gick inte att spara." }, 500);
        return svar({ ok: "", url: nuv.previous ? bildAdress(mig, nu) : null });
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch {
    return svar({ fel: "Det gick inte att spara." }, 500);
  }
}
