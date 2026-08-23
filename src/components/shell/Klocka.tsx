import { Ikon } from "./Ikon";
import { Notisklocka } from "./Notisklocka";
import { hamtaNotiser } from "@/lib/notiser-server";
import type { CurrentUser } from "@/lib/auth";

/**
 * Klockan, hamtad UTANFOR den blockerande vagen.
 *
 * ===========================================================================
 * VARFOR DEN LIGGER I EN EGEN KOMPONENT
 *
 * `hamtaNotiser()` staller sexton fragor. De gar parallellt, men de gick
 * tidigare i (app)/layout.tsx — och en layout maste vara klar innan NAGOT av
 * sidan far skickas. Sexton fragor som ingen bett om holl alltsa tillbaka bade
 * skalet och innehallet pa varje sidvisning i navet.
 *
 * Nu ligger de bakom en <Suspense> i layouten. Skalet och sidan gar ivag med en
 * gang och klockan fylls i nar svaren kommer. Ingen fraga ar borttagen och
 * ingenting laser annorlunda — det som andrats ar vad som far VANTA pa vad.
 *
 * Skelettet nedan ar exakt lika stort som den riktiga knappen. En topprad som
 * hoppar till nar klockan dyker upp vore att byta en langsam sida mot en
 * ryckig.
 * ===========================================================================
 */
export async function Klocka({ user }: { user: CurrentUser }) {
  const notiser = await hamtaNotiser(user);
  return <Notisklocka notiser={notiser} />;
}

export function KlockaSkelett() {
  return (
    <div
      aria-hidden="true"
      className="grid size-11 shrink-0 place-items-center rounded-full text-ink-300"
    >
      <Ikon namn="klocka" />
    </div>
  );
}
