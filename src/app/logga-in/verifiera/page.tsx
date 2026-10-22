import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { datumText, sakerNasta } from "@/lib/inloggning";
import { kraverMfa, kvittoGiltigt, STEG2_DYGN, STEG2_KAKA } from "@/lib/mfa";
import { Skal } from "../Skal";
import { Verifiera } from "./Verifiera";

export const metadata = { title: "Bekräfta inloggning — Clicknet Nav" };

/**
 * Steg två vid inloggning. Sidan ligger under /logga-in eftersom den är en del
 * av inloggningen och därför inte får kräva ett färdigt steg två för att få
 * ritas: annars skickar mellanvaran hit och hit igen.
 */
export default async function VerifieraSida({
  searchParams,
}: {
  searchParams: Promise<{ nasta?: string }>;
}) {
  const sp = await searchParams;
  // Öppen vidarebefordran är en riktig risk på just den här sidan: det är hit
  // en angripare vill styra någon precis efter en lyckad inloggning. Bara
  // vägar inom navet släpps igenom (sakerNasta stänger även "/\värd").
  const nasta = sakerNasta(sp.nasta);

  const user = await getCurrentUser();
  if (!user) redirect("/logga-in");

  // Inget steg två att göra: vidare dit man var på väg, inte till startsidan.
  const kvitto = (await cookies()).get(STEG2_KAKA)?.value;
  if (!kraverMfa(user) || (await kvittoGiltigt(kvitto, user.authUserId))) redirect(nasta);

  const nu = new Date();
  const minnsTill = datumText(new Date(nu.getTime() + STEG2_DYGN * 24 * 60 * 60 * 1000), nu);

  return (
    <Skal
      fot={
        // Utloggningen är en POST. En länk hade gett 405, och en utloggning
        // som går att utlösa med en GET går att utlösa från någon annans sida.
        <form action="/auth/logga-ut" method="post">
          Inte du?{" "}
          <button type="submit" className="in-lank">
            Logga ut
          </button>
        </form>
      }
    >
      <Verifiera epost={user.email} nasta={nasta} minnsTill={minnsTill} />
    </Skal>
  );
}
