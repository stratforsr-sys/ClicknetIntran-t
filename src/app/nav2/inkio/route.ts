import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { bolagsuppslag, inkioKonfigurerad, kundaktivitet, landningssida } from "@/lib/crm/inkio";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: det kundkortet och orderformularet laser ur Inkio, nar det oppnas.
 *
 *   ?vad=kund&order=<uuid>   aktiviteten och landningssidan (kundkortets Aktivitet)
 *   ?vad=bolag&orgnr=<nr>    namn och adress fran Bolagsverket (formularets uppslag)
 *
 * BARA LASNING. Samma funktioner som /order anropar via `hamtaInkioAktivitet`,
 * `hamtaLandningssida` och `slaUppBolag`, och samma kontroll fore: ordern lases
 * med anvandarens token, sa RLS avgor om hen far fraga Inkio om kunden alls.
 *
 * `kopplat: false` betyder att Inkio inte ar konfigurerat i den har miljon —
 * da sager kortet det i stallet for att lata som att kunden saknas.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return NextResponse.json({ fel: "Inte inloggad." }, { status: 401 });

  const url = new URL(request.url);
  const vad = url.searchParams.get("vad");
  const kopplat = inkioKonfigurerad();
  const svar = (data: unknown, status = 200) =>
    NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

  try {
    if (vad === "kund") {
      const id = url.searchParams.get("order") ?? "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return svar({ fel: "Ordern finns inte." }, 400);
      const rls = await supabaseServer();
      const { data } = await rls.from("sales_order").select("org_number").eq("id", id).maybeSingle();
      if (!data) return svar({ fel: "Ordern finns inte, eller så får du inte se den." }, 404);
      if (!kopplat) return svar({ kopplat });
      const orgnr = String(data.org_number ?? "");
      const [aktivitet, sida] = await Promise.all([
        kundaktivitet(orgnr).catch((e: unknown) => ({ fel: e instanceof Error ? `Inkio svarade inte: ${e.message}` : "Inkio svarade inte." })),
        landningssida(orgnr).catch((e: unknown) => ({ fel: e instanceof Error ? `Inkio svarade inte: ${e.message}` : "Inkio svarade inte." })),
      ]);
      return svar({ kopplat, aktivitet, sida, hamtad: new Date().toISOString() });
    }

    if (vad === "bolag") {
      if (!kopplat) return svar({ kopplat });
      const orgnr = url.searchParams.get("orgnr") ?? "";
      return svar({ kopplat, bolag: await bolagsuppslag(orgnr) });
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }

  return svar({ fel: "Okänd fråga." }, 400);
}
