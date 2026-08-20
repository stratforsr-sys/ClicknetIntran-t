"use server";

import { getCurrentUser } from "@/lib/auth";
import { markeraSedd } from "@/lib/notiser-server";

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
