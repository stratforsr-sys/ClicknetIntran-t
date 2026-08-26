"use server";

import { getCurrentUser } from "@/lib/auth";
import { avfardaNotis, markeraSedd } from "@/lib/notiser-server";
import { arNotisId } from "@/lib/notiser";

/**
 * Anropas nar klockan oppnas.
 *
 * Ingen `revalidatePath` har. Klienten kor `router.refresh()` efterat, och den
 * traffar bara den vy anvandaren star i — en revalidering av hela layouten
 * hade slagit ut cachen for varenda sida for att nagon tittade i en meny.
 */
export async function markeraNotiserLasta(): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee) return;
  await markeraSedd(user.employee.id);
}

/**
 * Anropas nar en enskild notis klickas. Posten forsvinner ur klockan.
 *
 * DEN GALLER BARA DEN SOM ANROPAR. `employee_id` kommer ur sessionen och aldrig
 * ur argumentet — allt som exporteras ur en `"use server"`-fil ar en publik
 * andpunkt, och ett id i argumentlistan hade latit vem som helst tysta nagon
 * annans klocka.
 *
 * Ingen `revalidatePath`. Klienten tar bort raden ur sin egen lista med en gang
 * och navigerar vidare; nasta sidvisning hamtar listan pa nytt anda. En
 * revalidering hade slagit ut cachen for varenda sida for att nagon klickade i
 * en meny — samma skal som star over `markeraNotiserLasta` ovan.
 *
 * TYST VID OGILTIGT ID. Klicket navigerar samtidigt, och ett kastat fel hade
 * blivit en rod ruta ovanpa den sida anvandaren just bad om — for en notis som
 * anda inte fanns.
 */
export async function avfardaNotisen(noticeId: string): Promise<void> {
  if (!arNotisId(noticeId)) return;
  const user = await getCurrentUser();
  if (!user?.employee) return;
  await avfardaNotis(user.employee.id, noticeId);
}
