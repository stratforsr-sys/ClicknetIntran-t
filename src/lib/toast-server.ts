import { cookies } from "next/headers";
import { TOAST_KAKA, tillKaka, type Angrabar } from "@/lib/toast";

/**
 * E5.7. Skriver kvittot som visas efter nasta sidvisning.
 *
 * ===========================================================================
 * VARFOR DEN INTE LIGGER I angra/actions.ts LANGRE
 *
 * Den filen bar `"use server"`, och ALLT som exporteras ur en sadan fil blir
 * en publik andpunkt: Next ger funktionen ett id och tar emot anrop till den
 * fran webblasaren, oavsett om nagon UI-kod anropar den eller inte.
 *
 * For `sattKvitto` var foljden liten — den skriver en kortlivad kaka i den
 * anropandes egen webblasare, och React escapar texten nar kvittot ritas. Men
 * en hjalpare ska inte publiceras som handling, och skillnaden mellan "liten
 * foljd" och "ingen andpunkt" ar hela poangen: nasta hjalpare som laggs
 * bredvid kanske inte ar lika ofarlig.
 *
 * Hittad av sakerhetsgenomgangen 2026-08-23.
 * ===========================================================================
 *
 * Ligger har och inte i toast.ts, eftersom `cookies()` bara gar att skriva
 * fran en server action eller en route handler. toast.ts ar ren logik utan
 * importer och lases aven av klientkomponenten som ritar kvittot.
 *
 * Kakan ar kortlivad: den raderas av komponenten sa fort den ritats, och gar
 * ut av sig sjalv efter en minut om nagot gick fel pa vagen.
 */
export async function sattKvitto(kvitto: { text: string; angra?: { handling: Angrabar; id: string } }) {
  (await cookies()).set(TOAST_KAKA, tillKaka(kvitto), {
    path: "/",
    maxAge: 60,
    sameSite: "lax",
    httpOnly: false,
  });
}
