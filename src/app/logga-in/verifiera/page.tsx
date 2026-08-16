import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { kraverMfa, kvittoGiltigt, STEG2_KAKA } from "@/lib/mfa";
import { Verifiera } from "./Verifiera";

export const metadata = { title: "Bekräfta inloggning — Clicknet Nav" };

/**
 * Steg tva vid inloggning. Sidan ligger under /logga-in eftersom den ar en del
 * av inloggningen och darfor inte far krava ett fardigt steg tva for att fa
 * ritas — annars skickar mellanvaran hit och hit igen.
 */
export default async function VerifieraSida({
  searchParams,
}: {
  searchParams: Promise<{ nasta?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/logga-in");

  const kvitto = (await cookies()).get(STEG2_KAKA)?.value;
  if (!kraverMfa(user) || (await kvittoGiltigt(kvitto, user.authUserId))) redirect("/");

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
          <p className="text-body text-ink-500">
            Din roll når personuppgifter och lönedata. Därför bekräftar vi att det är du.
          </p>
        </div>

        <div className="rounded-md bg-surface p-6 shadow-elev-1">
          <Verifiera epost={user.email} nasta={nasta} />
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
