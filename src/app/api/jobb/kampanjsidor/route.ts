import { NextResponse, type NextRequest } from "next/server";
import { kontrolleraCron } from "@/lib/jobb/behorighet";
import { supabaseAdmin } from "@/lib/supabase/server";
import { inkioKonfigurerad, kampanjadress, kollaSida } from "@/lib/crm/inkio";
import { notifiera } from "@/lib/notishandelse-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Nav 2.0 (0083): kampanjsidorna, var tionde minut.
 *
 * Kundkortet säger om kundens kampanjsida svarar, hur snabbt, när den senast
 * kollades och hur de sju senaste dagarna sett ut. Det kräver att någon kollar
 * även när ingen har kortet öppet — det gör det här jobbet, som `pg_cron`
 * ringer via `kalla_jobb()` (0059). Schemat ligger i
 * `supabase/vantar/order_jobb.sql` och läggs in först när beställaren sagt ja.
 *
 * Kunderna är de med en order i kraft (signerad eller betald). Adressen är
 * kundens Webbplats i Inkio, hämtad på nytt en gång per dygn. Kollen är
 * kundkortets egen (`provaSidan` via `kollaSida`), fem sidor åt gången, och
 * en rad per sida skrivs i `landing_page_check`. Rader äldre än 14 dagar
 * gallras.
 *
 * 0086: en öppen anmälan ("Meddela leveransen") stängs när sidan svarar igen,
 * och den som anmälde får besked.
 */

const SAMTIDIGA = 5;
const DYGN = 24 * 3600 * 1000;

async function kor(request: NextRequest) {
  const nekad = kontrolleraCron(request);
  if (nekad) return nekad;
  if (!inkioKonfigurerad()) return NextResponse.json({ hoppade_over: "Inkio är inte konfigurerat" });

  const db = supabaseAdmin();
  const { data: ordrar } = await db.from("sales_order").select("org_number").in("status", ["signerad", "betald"]);
  const kunder = [...new Set((ordrar ?? []).map((o) => o.org_number as string).filter(Boolean))];
  const { data: sidor } = await db.from("landing_page").select("org_number, url, refreshed_at");
  const kanda = new Map((sidor ?? []).map((s) => [s.org_number as string, s]));

  const fel: string[] = [];
  let kollade = 0;
  for (let i = 0; i < kunder.length; i += SAMTIDIGA) {
    await Promise.all(
      kunder.slice(i, i + SAMTIDIGA).map(async (org) => {
        try {
          let sida = kanda.get(org);
          if (!sida || Date.now() - Date.parse(sida.refreshed_at as string) > DYGN) {
            const a = await kampanjadress(org);
            await db.from("landing_page").upsert({ org_number: org, url: a.adress, refreshed_at: new Date().toISOString() }, { onConflict: "org_number" });
            sida = { org_number: org, url: a.adress, refreshed_at: new Date().toISOString() };
          }
          if (!sida.url) return;
          const lage = await kollaSida(sida.url as string);
          await db.from("landing_page_check").insert({ org_number: org, ok: lage.aktiv, ms: lage.aktiv ? lage.ms : null, error: lage.aktiv ? null : lage.text.slice(0, 300) });
          kollade++;
          if (lage.aktiv) {
            const { data: anmalan } = await db.from("landing_page_report").select("id, reported_by").eq("org_number", org).is("resolved_at", null).maybeSingle();
            if (anmalan) {
              await db.from("landing_page_report").update({ resolved_at: new Date().toISOString() }).eq("id", anmalan.id);
              if (anmalan.reported_by) {
                await notifiera({ till: anmalan.reported_by as string, av: null, kalla: "kampanjsida-uppe", typ: "order", rubrik: "Kampanjsidan svarar igen", detalj: sida.url as string, href: "/order", objekt: { typ: "customer", id: org } });
              }
            }
          }
        } catch (e) {
          fel.push(`${org}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
        }
      }),
    );
  }

  await db.from("landing_page_check").delete().lt("checked_at", new Date(Date.now() - 14 * DYGN).toISOString());
  return NextResponse.json({ kunder: kunder.length, kollade, fel });
}

export async function POST(request: NextRequest) {
  return kor(request);
}

export async function GET(request: NextRequest) {
  return kor(request);
}
