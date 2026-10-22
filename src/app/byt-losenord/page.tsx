import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { kraverByte } from "@/lib/losenordsbyte";
import { ATERSTALL_KAKA, aterstallningTill } from "@/lib/aterstallning";
import { namnFor } from "@/lib/inloggning-server";
import { fornamn, klockslag } from "@/lib/inloggning";
import { Skal } from "@/app/logga-in/Skal";
import { Formular, type Bytesorsak } from "./Formular";

export const dynamic = "force-dynamic";
export const metadata = { title: "Byt lösenord — Clicknet Nav" };

/**
 * Egen sida utanför (app), utan navigering.
 *
 * Den som måste byta ska inte ha något annat att klicka på. Skälet är inte
 * pedagogiskt utan praktiskt: så länge tvånget står kvar skickar mellanvaran
 * tillbaka hit från varje annan sida, och en meny full av länkar som alla
 * studsar tillbaka är en trasig produkt.
 *
 * Tre skäl att vara här: tvånget vid första inloggningen, "Glömt lösenordet?"
 * (ett giltigt kvitto från engångskoden, se src/lib/aterstallning.ts) och ett
 * frivilligt byte. Har man både tvånget och kvittot räcker kvittot: den som
 * glömt sitt tillfälliga lösenord ska inte behöva det.
 */
export default async function BytLosenordSida() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/logga-in");

  const tvingat = kraverByte(user.app_metadata);
  const fore = await aterstallningTill((await cookies()).get(ATERSTALL_KAKA)?.value, user.id);
  const orsak: Bytesorsak = fore ? "glomt" : tvingat ? "tvingat" : "frivilligt";
  // Första inloggningen hälsar med namn. Bara då behövs namnet, och bara då
  // är kontots egen token blind för personalregistret (se namnFor).
  const namn = orsak === "tvingat" ? fornamn(await namnFor(user.id)) : null;

  return (
    <Skal
      fot={
        orsak === "frivilligt" ? (
          // Ett vanligt a-element: /nav2 är en rutt och ingen React-sida.
          <a href="/nav2" className="in-lank">
            Tillbaka till navet
          </a>
        ) : (
          // Utloggningen är en POST. En länk hade gett 405, och en utloggning
          // som går att utlösa med en GET går att utlösa från någon annans sida.
          <form action="/auth/logga-ut" method="post">
            Inloggad som {user.email}. Fel person?{" "}
            <button type="submit" className="in-lank">
              Logga ut
            </button>
          </form>
        )
      }
    >
      <Formular orsak={orsak} epost={user.email ?? ""} fornamn={namn} fore={fore ? klockslag(fore) : null} />
    </Skal>
  );
}
