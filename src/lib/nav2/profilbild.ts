import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nav 2.0, Profil: hur länge en borttagen eller utbytt profilbild finns kvar
 * (granskningen 2026-10-22, F1-11).
 *
 * "Ta bort" och ett byte sparar den förra bilden i `employee_photo.previous`, så
 * att Ångra kan lägga tillbaka den. Ångra gäller i tio minuter. Den förra bilden
 * tas bort av nattjobbet (`rensaForraBilder`), alltså senast natten efter. Bara
 * service role läser `previous` (kolumnrättigheterna i 0107).
 */
export const ANGRA_MINUTER = 10;

export function angraGaller(uppdaterad: string | null | undefined, nu: Date = new Date()): boolean {
  if (!uppdaterad) return false;
  const t = Date.parse(uppdaterad);
  return Number.isFinite(t) && nu.getTime() - t <= ANGRA_MINUTER * 60_000;
}

/** Nattjobbet: förra bilden bort där Ångra inte längre gäller. Returnerar antalet. */
export async function rensaForraBilder(db: SupabaseClient, nu: Date = new Date()): Promise<number> {
  const grans = new Date(nu.getTime() - ANGRA_MINUTER * 60_000).toISOString();
  const { data, error } = await db
    .from("employee_photo")
    .update({ previous: null })
    .not("previous", "is", null)
    .lt("updated_at", grans)
    .select("employee_id");
  if (error) throw new Error(`Profilbilderna kunde inte rensas: ${error.message}`);
  return (data ?? []).length;
}
