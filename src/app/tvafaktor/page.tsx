import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { kraverMfa, harVerifieradFaktor } from "@/lib/mfa";
import { Mfa } from "@/app/(app)/profil/Mfa";

export const metadata = { title: "Aktivera tvåfaktor — Clicknet Nav" };

/**
 * AC-1.1, K33. Grinden ligger utanfor (app)-gruppen med flit: den har varken
 * sidopanel eller genvagar in i navet. Den som maste ha tvafaktor kommer
 * ingenstans forran den ar pa plats — och det ska synas att det ar ett krav,
 * inte ett tips pa en instaellningssida.
 */
export default async function TvafaktorSida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/logga-in");
  if (!kraverMfa(user)) redirect("/profil");
  if (harVerifieradFaktor(user)) redirect("/");

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-[30rem]">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-sm bg-brand-900 font-display text-h1 leading-none text-brand-500">
            C
          </span>
          <h1 className="text-display text-ink-900">Aktivera tvåfaktor</h1>
          <p className="text-body text-ink-500">
            Din roll når personuppgifter och lönedata. Innan du kommer in i navet behöver
            inloggningen ett steg till än lösenordet.
          </p>
        </div>

        <div className="rounded-md bg-surface p-6 shadow-elev-1">
          <Mfa harFaktor={false} obligatorisk klarHref="/" />
        </div>

        <form action="/auth/logga-ut" method="post" className="mt-6 text-center">
          <button type="submit" className="text-small text-ink-500 underline hover:text-ink-900">
            Logga ut i stället
          </button>
        </form>
      </div>
    </main>
  );
}
