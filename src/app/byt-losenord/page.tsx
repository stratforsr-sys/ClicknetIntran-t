import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { kraverByte } from "@/lib/losenordsbyte";
import { Formular } from "./Formular";

export const dynamic = "force-dynamic";
export const metadata = { title: "Byt lösenord — Clicknet Nav" };

/**
 * Egen sida utanfor (app), utan navigering.
 *
 * Den som maste byta ska inte ha nagot annat att klicka pa. Skalet ar inte
 * pedagogiskt utan praktiskt: sa lange tvanget star kvar skickar mellanvaran
 * tillbaka hit fran varje annan sida, och en meny full av lankar som alla
 * studsar tillbaka ar en trasig produkt.
 */
export default async function BytLosenordSida() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/logga-in");

  const tvingat = kraverByte(user.app_metadata as Record<string, unknown>);

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-[26rem]">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-sm bg-brand-900 font-display text-h1 leading-none text-brand-500">
            C
          </span>
          <h1 className="text-display text-ink-900">
            {tvingat ? "Välj ett eget lösenord" : "Byt lösenord"}
          </h1>
          <p className="max-w-[34ch] text-body text-ink-500">
            {tvingat
              ? "Lösenordet du fick är känt av den som lade upp dig. Det här blir bara ditt."
              : "Du kan byta när du vill. Det gamla slutar gälla direkt."}
          </p>
        </div>

        <div className="rounded-md bg-surface p-6 shadow-elev-1">
          <Formular tvingat={tvingat} />
        </div>

        <p className="mt-6 text-center text-small text-ink-500">
          {tvingat ? (
            <>
              Inloggad som {user.email}. Är det fel person?{" "}
              {/* Utloggningen ar en POST. En lank hade gett 405, och en
                  utloggning som gar att utlosa med en GET gar att utlosa
                  fran nagon annans sida. */}
              <form action="/auth/logga-ut" method="post" className="inline">
                <button type="submit" className="font-semibold text-brand-700 hover:underline">
                  Logga ut
                </button>
              </form>
              .
            </>
          ) : (
            <Link href="/" className="font-semibold text-brand-700 hover:underline">
              Tillbaka till navet
            </Link>
          )}
        </p>
      </div>
    </main>
  );
}
