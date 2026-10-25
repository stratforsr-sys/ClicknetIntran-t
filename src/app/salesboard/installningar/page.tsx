import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Säljtavlans inställningar finns i Nav 2.0: Inställningar → Säljtavlan, bara för
 * superadmin (beställaren 2026-10-25). Den gamla adressen står kvar för bokmärken
 * och skickas dit. `/salesboard` är öppen i mellanvaran, så den här sidan läser
 * ingenting: `/nav2` frågar själv efter inloggningen, och sektionen syns bara för
 * den som får ändra tavlan.
 */
export default function Installningar(): never {
  redirect("/nav2?till=%2Finstallningar%2Fsalesboard");
}
