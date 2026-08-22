import { Formular } from "./Formular";

export const dynamic = "force-dynamic";

/**
 * E0.6. Oppen for alla inloggade — det ar hela poangen.
 *
 * Ingen rollkontroll har. Den som ska rapportera ett fel ar den som rakade ut
 * for det, och det ar oftast en saljare. En rapportvag som kraver behorighet
 * rapporterar bara de fel cheferna sjalva stoter pa.
 */
export default async function NyFelrapport({
  searchParams,
}: {
  searchParams: Promise<{ digest?: string }>;
}) {
  const { digest } = await searchParams;
  return <Formular digest={digest ?? ""} />;
}
