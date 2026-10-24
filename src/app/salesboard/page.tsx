import { tavlansAtkomst } from "@/lib/salesboard/atkomst";
import { byggTavlan } from "@/lib/salesboard/tavlan";
import type { Ogonblick } from "@/lib/salesboard/typer";
import Parning, { Avbrott } from "./Parning";
import Tavla from "./Tavla";

/**
 * /salesboard: tavlan för den som får se den, annars parningen (spec §9).
 *
 * En parad skärm (kakan `nav_tavla`) och en inloggad anställd får tavlan, med en
 * färdig ögonblicksbild så att första bilden är rätt utan att vänta på källan.
 * Klienten hämtar sedan själv (kalla.ts).
 *
 * ===========================================================================
 * ETT FEL ÄR INTE "INTE PARAD".
 *
 * Kastar åtkomsten eller bygget (databasen, nätet) visas `Avbrott`, som
 * försöker igen av sig själv. Parningen visas bara när åtkomsten säkert säger
 * att det varken finns en parad skärm eller en inloggad anställd: annars hade en
 * TV med en giltig kaka börjat visa en kod vid varje avbrott i databasen.
 * ===========================================================================
 */
export const dynamic = "force-dynamic";

export default async function Saljtavlan() {
  let atkomst: Awaited<ReturnType<typeof tavlansAtkomst>>;
  try {
    atkomst = await tavlansAtkomst();
  } catch (e) {
    console.error("salesboard: åtkomsten", e instanceof Error ? e.message : e);
    return <Avbrott />;
  }
  if (!atkomst) return <Parning />;

  let start: Ogonblick;
  try {
    const skarm = atkomst.typ === "skarm" ? { namn: atkomst.skarm.namn, ljud: atkomst.skarm.ljud } : null;
    start = await byggTavlan(skarm);
  } catch (e) {
    console.error("salesboard: bilden", e instanceof Error ? e.message : e);
    return <Avbrott />;
  }
  return <Tavla start={start} kalla="nat" />;
}
