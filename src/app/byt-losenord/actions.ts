"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { utforBytLosenord } from "@/lib/losenordsbyte-server";

export type BytState = { fel?: string[] };

/**
 * Tvingat byte. Samma kontroller som pa profilsidan — de bor i
 * `utforBytLosenord` just for att de tva vagarna inte ska glida isar.
 *
 * Skillnaden ar bara vad som hander efterat: harifran gar man vidare in i
 * navet, dar stannar man kvar pa sidan.
 */
export async function bytLosenord(_prev: BytState, form: FormData): Promise<BytState> {
  const user = await getCurrentUser();
  if (!user) redirect("/logga-in");

  const resultat = await utforBytLosenord(
    user,
    String(form.get("gammalt") ?? ""),
    String(form.get("nytt") ?? ""),
    String(form.get("upprepat") ?? ""),
  );
  if (resultat.fel) return resultat;

  redirect("/");
}
