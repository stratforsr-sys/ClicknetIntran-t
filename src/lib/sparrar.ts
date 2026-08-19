import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/server";
import { NODSTOPP_STAMPLING, NODSTOPP_RAST } from "@/lib/tid";

/**
 * Vad som är påslaget just nu — läst ur databasen, inte ur en kodkonstant.
 *
 * Tidigare stod K12 som en kommentar i `tid.ts` och en `const RAST_AKTIV =
 * false` som någon skulle komma ihåg att ändra samtidigt som juridiken blev
 * klar. Nu ligger villkoren i `compliance_gate` med en trigger som vägrar
 * påslag utan underlag, och koden läser läget.
 *
 * Kvar i kod finns bara nödstoppen. De är enkelriktade: de kan stänga av något
 * som databasen säger är på, aldrig tvärtom. Den dag något går fel ska det gå
 * att stoppa med en deploy, utan att någon behöver komma åt databasen.
 */
export type Lage = { stampling: boolean; rast: boolean };

/**
 * Fail-closed för rasten, fail-open för stämplingen.
 *
 * Går databasen inte att läsa ska ingen övervakning av raster smyga igång — men
 * säljarna ska heller inte stå utan stämpelklocka för att en fråga tog timeout.
 * Stämplingen har dessutom sitt eget nödstopp i koden om den ska bort.
 */
const VID_FEL: Lage = { stampling: true, rast: false };

export const hamtaLage = cache(async (): Promise<Lage> => {
  try {
    const { data, error } = await supabaseAdmin()
      .from("compliance_gate")
      .select("key, enabled");

    if (error || !data) return tillampaNodstopp(VID_FEL);

    const pa = new Map(data.map((r) => [r.key, r.enabled]));
    return tillampaNodstopp({
      stampling: pa.get("stampling") ?? VID_FEL.stampling,
      rast: pa.get("raststampling") ?? false,
    });
  } catch {
    return tillampaNodstopp(VID_FEL);
  }
});

function tillampaNodstopp(lage: Lage): Lage {
  return {
    stampling: lage.stampling && !NODSTOPP_STAMPLING,
    rast: lage.rast && !NODSTOPP_RAST,
  };
}

export type Sparr = {
  key: string;
  title: string;
  enabled: boolean;
  enabled_at: string | null;
  note: string | null;
  interest_assessment_id: string | null;
  staff_information_id: string | null;
  saknas: string[];
};

/**
 * Hela bilden för spärrvyn, inklusive vad som saknas.
 *
 * `sparr_saknas` är samma funktion som triggern dömer efter. Att vyn och
 * spärren läser ur samma källa är avsiktligt: en lista som räknas ut på två
 * ställen hinner glida isär, och då står det "allt klart" på en sida medan
 * knappen vägrar.
 */
export async function hamtaSparrar(): Promise<Sparr[]> {
  const db = supabaseAdmin();

  const { data } = await db
    .from("compliance_gate")
    .select("key, title, enabled, enabled_at, note, interest_assessment_id, staff_information_id")
    .order("key");

  const ut: Sparr[] = [];
  for (const rad of data ?? []) {
    const { data: saknas } = await db.rpc("sparr_saknas", { p_key: rad.key });
    ut.push({ ...rad, saknas: (saknas as string[] | null) ?? [] });
  }

  return ut;
}
