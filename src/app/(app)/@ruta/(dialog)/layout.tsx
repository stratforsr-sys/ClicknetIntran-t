import { redirect } from "next/navigation";
import { getCurrentUser, fullName } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { installningsPoster } from "@/components/shell/installningar-poster";
import { Ruta } from "@/components/shell/Ruta";

/**
 * Rutans ram, delad av varje panel i sloten.
 *
 * Att den ar en LAYOUT och inte en del av varje sida ar hela poangen: en
 * layout star kvar nar man byter mellan syskonrutter, sa <dialog>-elementet
 * behaller sitt oppna lage och sitt fokus medan bara innehallet byts.
 *
 * Den ligger i rutt-gruppen `(dialog)` och inte direkt i sloten, eftersom
 * `default.tsx` da hade fatt samma ram — och rutan hade ritats pa varje sida
 * i navet, tom.
 */
export default async function RutLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/logga-in");

  const roll = user.roles.length ? ROLE_LABEL[user.roles[0]] : "Väntar på roll";

  return (
    <Ruta poster={installningsPoster(user)} namn={fullName(user.employee)} roll={roll}>
      {children}
    </Ruta>
  );
}
