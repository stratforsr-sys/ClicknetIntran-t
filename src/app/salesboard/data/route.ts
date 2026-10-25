import { fornyaSkarmkakan, tavlansAtkomst } from "@/lib/salesboard/atkomst";
import { svar } from "@/lib/salesboard/svar";
import { byggTavlan } from "@/lib/salesboard/tavlan";

export const dynamic = "force-dynamic";

/**
 * Säljtavlan: ögonblicksbilden (`Ogonblick`) som JSON.
 *
 * Tavlan hämtar den när ringklockan säger att något ändrats, och annars med
 * jämna mellanrum (spec §8). En parad skärm och en inloggad anställd får den,
 * ingen annan (`atkomst.ts`).
 *
 *   401  säkert ingen åtkomst: ingen kaka och ingen session, en bortkopplad
 *        skärm, eller en inloggad som inte är en aktiv anställd. TV:n visar
 *        parningen.
 *   503  åtkomsten eller bilden gick inte att avgöra just nu (ett databasfel,
 *        aldrig 401). TV:n behåller den bild den har och försöker igen, och
 *        efter två minuter står det att den är offline.
 *
 * INGEN ETAG. `nu` i bilden ändras vid varje bygge, så taggen hade aldrig
 * stämt, och bilden är några kilobyte.
 *
 * En skärms kaka förnyas här en gång per dygn, så att en TV som står på aldrig
 * loggas ut.
 */

const INTE_NU = "Tavlan kunde inte läsas just nu.";

export async function GET(request: Request) {
  let atkomst: Awaited<ReturnType<typeof tavlansAtkomst>>;
  try {
    atkomst = await tavlansAtkomst(request);
  } catch (e) {
    console.error("salesboard/data: åtkomsten", e instanceof Error ? e.message : e);
    return svar({ fel: INTE_NU }, 503);
  }
  if (!atkomst) return svar({ fel: "Skärmen är inte parad." }, 401);

  try {
    const skarm = atkomst.typ === "skarm" ? { namn: atkomst.skarm.namn, ljud: atkomst.skarm.ljud } : null;
    const res = svar(await byggTavlan(skarm));
    if (atkomst.typ === "skarm") await fornyaSkarmkakan(res);
    return res;
  } catch (e) {
    console.error("salesboard/data: bilden", e instanceof Error ? e.message : e);
    return svar({ fel: INTE_NU }, 503);
  }
}
