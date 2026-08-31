import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { Progress } from "@/lib/guider";
import { arKlar } from "@/lib/guider";
import { hamtaGuide, startguiden } from "@/guider";
import type { Guide } from "@/guider";

/**
 * Läser och bokför var någon står i sina guider.
 *
 * ===========================================================================
 * VARFÖR SERVICE ROLE OCH INTE ANVÄNDARENS EGEN TOKEN
 *
 * `guide_progress` har ingen skrivpolicy alls (se 0040). Det är avsiktligt och
 * samma val som `notification_dismissed` gjorde i 0038: allt som exporteras ur
 * en "use server"-fil är en publik slutpunkt, och en skrivpolicy hade räckt för
 * att vem som helst skulle kunna bokföra en avklarad onboarding i någon annans
 * namn. Med bara service role finns det exakt en väg in, och den vägen tar
 * `employee_id` ur sessionen — aldrig ur ett argument.
 * ===========================================================================
 *
 * FEL SVÄLJS I LÄSNINGEN, MEN INTE I SKRIVNINGEN. En guide som inte kan läsa
 * sin progress ska visa turen från början, inte hindra någon från att komma in
 * i navet. En skrivning som misslyckas ska däremot märkas: annars går personen
 * igenom tio steg och får börja om nästa dag utan att förstå varför.
 */

/** Alla rader för en person. En rad per guide hon rört. */
export async function hamtaProgress(employeeId: string): Promise<Progress[]> {
  const { data, error } = await supabaseAdmin()
    .from("guide_progress")
    .select("guide_slug, version, steg, completed_at")
    .eq("employee_id", employeeId);

  if (error || !data) return [];
  return data as Progress[];
}

export async function hamtaEnProgress(
  employeeId: string,
  slug: string,
): Promise<Progress | null> {
  const { data } = await supabaseAdmin()
    .from("guide_progress")
    .select("guide_slug, version, steg, completed_at")
    .eq("employee_id", employeeId)
    .eq("guide_slug", slug)
    .maybeSingle();

  return (data as Progress | null) ?? null;
}

/**
 * Bokför att personen kommit till steg `steg` i den fullständiga listan.
 *
 * `completed_at: null` skrivs med flit vid varje steg. Den som gör om en guide
 * efter en versionshöjning ska inte ha kvar sitt gamla klarmärke medan hon står
 * mitt i turen — annars ser hon "Klar" i listan samtidigt som rutan står öppen
 * på steg tre.
 */
export async function bokforSteg(
  employeeId: string,
  slug: string,
  version: number,
  steg: number,
): Promise<void> {
  await supabaseAdmin()
    .from("guide_progress")
    .upsert(
      {
        employee_id: employeeId,
        guide_slug: slug,
        version,
        steg,
        completed_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,guide_slug" },
    );
}

/** Sista steget är gjort. Klarmärket är den enda kolumn som betyder "klar". */
export async function bokforKlar(
  employeeId: string,
  slug: string,
  version: number,
  antalSteg: number,
): Promise<void> {
  const nu = new Date().toISOString();
  await supabaseAdmin()
    .from("guide_progress")
    .upsert(
      {
        employee_id: employeeId,
        guide_slug: slug,
        version,
        steg: antalSteg,
        completed_at: nu,
        updated_at: nu,
      },
      { onConflict: "employee_id,guide_slug" },
    );
}

/**
 * Gör om en guide frivilligt.
 *
 * Raden RADERAS i stället för att nollställas. Historiken den bar — "klar den
 * fjortonde" — är inte något navet lovat att spara, och en rad med steg 0 och
 * ett gammalt `started_at` är svårare att läsa än ingen rad alls. Den som gör
 * om turen börjar om, och nästa steg skriver en ny rad.
 */
export async function aterstallGuide(employeeId: string, slug: string): Promise<void> {
  await supabaseAdmin()
    .from("guide_progress")
    .delete()
    .eq("employee_id", employeeId)
    .eq("guide_slug", slug);
}

export type Autostart = { guide: Guide; sparat: number };

/**
 * Guiden som ska starta av sig själv nu, om någon ska det.
 *
 * ===========================================================================
 * DET HÄR ÄR HELA "OBLIGATORISKT" SÅ SOM DET SER UT EFTER 2026-08-31.
 *
 * Beställaren strök funktionsspärrarna: ingen knapp låser sig, ingen modul
 * stänger. Det enda som är tvingande är den här — orienteringen startar vid
 * första inloggningen och rutan står kvar tills den är genomgången. Den går att
 * pausa (rutan försvinner för den sidvisningen) men inte att bocka bort, och
 * den kommer tillbaka nästa gång sidan laddas.
 *
 * Skälet att den ändå inte är en vägg: den ligger OVANPÅ navet, inte i vägen
 * för det. En ny säljare som måste stämpla in kan pausa, stämpla och fortsätta.
 * Det som gör den obligatorisk är att den inte glömmer bort sig.
 * ===========================================================================
 */
export async function autostart(employeeId: string): Promise<Autostart | null> {
  const guide = startguiden();
  if (!guide) return null;

  const progress = await hamtaEnProgress(employeeId, guide.slug);
  if (arKlar(guide, progress)) return null;

  return { guide, sparat: progress?.steg ?? 0 };
}

/** Guiden bakom en slug, eller null. Enda uppslaget server actions får använda. */
export function kandGuide(slug: string): Guide | null {
  return hamtaGuide(slug);
}
