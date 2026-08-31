import { getCurrentUser } from "@/lib/auth";
import { autostart, modulstart } from "@/lib/guider-server";
import { Guide } from "./Guide";

/**
 * Avgör om en guidad tur ska ligga över sidan just nu.
 *
 * ===========================================================================
 * VARFÖR DEN SITTER I LAYOUTEN OCH INTE PÅ STARTSIDAN
 *
 * En tur som handlar om navet måste kunna peka på navet: menyn, toppraden,
 * bottenraden. De ritas av layouten och finns på varje sida. Låg guiden i
 * `/`-sidan hade den försvunnit i samma sekund som användaren klickade på något
 * — vilket är precis vad turen ber henne göra.
 *
 * KOSTNADEN ÄR EN FRÅGA PER SIDVISNING, och bara för den som har en oavslutad
 * tur: `autostart()` slår upp en rad på primärnyckeln och svarar null för alla
 * andra. Den som är klar med sin onboarding betalar ett indexuppslag, och den
 * kostnaden är skälet att komponenten inte hämtar något mer än så.
 * ===========================================================================
 *
 * Ingen `Suspense` runt den här. Klockan i toppraden är strömmad för att den är
 * sexton frågor; den här är en. Att strömma den hade bara gett rutan en chans
 * att hoppa in en halv sekund efter att sidan ritats, mitt framför någon som
 * redan börjat läsa.
 */
export async function GuideVard({ slug }: { slug?: string } = {}) {
  const user = await getCurrentUser();
  if (!user?.employee) return null;

  // Den som är på väg ut ur bolaget ska inte onboardas in i det.
  if (user.employee.status === "offboarded") return null;

  /**
   * UTAN `slug` ÄR DET LAYOUTENS VÅRD: orienteringen, och ingenting annat.
   *
   * MED `slug` är det en modulsida som monterat sin egen guide. Den startar
   * första gången modulen öppnas och tystnar när den är genomgången — se
   * `modulstart()`, som också är det som håller isär de två så att aldrig fler
   * än en ruta står framme.
   */
  const start = slug
    ? await modulstart(user.employee.id, slug)
    : await autostart(user.employee.id);

  if (!start) return null;

  return <Guide guide={start.guide} sparat={start.sparat} />;
}
