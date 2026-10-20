import { redirect } from "next/navigation";

/**
 * Startsidan ar Nav 2.0 (bestallaren 2026-10-19: alla gar over, ingen vag
 * tillbaka). Inloggningen, steg tva, losenordsbytet och sidopanelens Hem
 * skickar hit, och harifran gar alla till /nav2. Den gamla startsidan finns i
 * historiken fore commiten som gjorde det har.
 */
export default function Startsida(): never {
  redirect("/nav2");
}
