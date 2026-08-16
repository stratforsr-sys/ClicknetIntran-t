import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Verifiera } from "./Verifiera";

export const metadata = { title: "Bekräfta inloggning — Clicknet Nav" };

/**
 * Steg tva vid inloggning. Mellanvaran skickar hit varje session som star pa
 * aal1 men har en verifierad faktor — alltsa: ratt losenord, men andra steget
 * saknas. Sidan ligger under /logga-in eftersom den ar en del av inloggningen
 * och darfor inte far krava en fardig session for att fa renderas.
 */
export default async function VerifieraSida({
  searchParams,
}: {
  searchParams: Promise<{ nasta?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/logga-in");

  const { data: niva } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (niva?.currentLevel === niva?.nextLevel) redirect("/");

  const { data: faktorer } = await supabase.auth.mfa.listFactors();
  const faktor = (faktorer?.all ?? []).find((f) => f.status === "verified");
  if (!faktor) redirect("/");

  // Oppen vidarebefordran ar en riktig risk pa just den har sidan: det ar hit
  // en angripare vill styra nagon precis efter en lyckad inloggning. Bara
  // vagar inom navet slapps igenom.
  const nasta = sp.nasta && /^\/(?!\/)/.test(sp.nasta) ? sp.nasta : "/";

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-[26rem]">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-sm bg-brand-900 font-display text-h1 leading-none text-brand-500">
            C
          </span>
          <h1 className="text-display text-ink-900">Ett steg till</h1>
          <p className="text-body text-ink-500">{user.email}</p>
        </div>

        <div className="rounded-md bg-surface p-6 shadow-elev-1">
          <Verifiera faktorId={faktor.id} nasta={nasta} />
        </div>
      </div>
    </main>
  );
}
