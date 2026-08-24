import type { CurrentUser } from "@/lib/auth";
import { canManageEmployees, hasRole } from "@/lib/auth";
import { farSeLonekostnad } from "@/lib/lonekostnad-server";
import { INSTALLNINGAR_START, type InstallningsPost } from "./installningar-delade";

/**
 * Vilka paneler installningarna har, och i vilken ordning.
 *
 * ADRESSERNA AR RIKTIGA RUTTER, inte flikar i en modal. Panelerna oppnas i
 * rutan nar man klickar sig dit inifran navet, och som helsida om man laddar
 * om eller foljer en delad lank. Det ar Next intercepting routes som gor
 * skillnaden, se src/app/(app)/@ruta/.
 *
 * Konsekvensen ar att administrationspanelerna behaller sina egna adresser.
 * Lanken till Franvaroregler inne pa /franvaro pekar alltsa pa samma stalle
 * som posten har, och bada oppnar rutan. En panel, en adress.
 *
 * Villkoren ar SAMMA som pa sidorna panelerna pekar pa. Star de isar blir
 * listan en meny som ljuger — den som klickar hamnar i en omdirigering.
 *
 * Modulen ar serverkod. Klientsidan tar emot listan som en prop; det den
 * behover av typer och konstanter bor i `installningar-delade.ts`.
 */
export function installningsPoster(user: CurrentUser | null): InstallningsPost[] {
  const poster: InstallningsPost[] = [
    { href: INSTALLNINGAR_START, label: "Konto", ikon: "konto" },
    { href: `${INSTALLNINGAR_START}/sakerhet`, label: "Säkerhet", ikon: "las" },
    { href: `${INSTALLNINGAR_START}/utseende`, label: "Utseende", ikon: "utseende" },
  ];

  if (canManageEmployees(user)) {
    poster.push({ href: "/tid/schema", label: "Scheman", ikon: "tid" });
  }
  if (hasRole(user, "sales_manager", "ceo")) {
    poster.push({ href: "/tid/sparrar", label: "Spärrar", ikon: "las" });
  }
  if (hasRole(user, "sales_manager", "ceo", "admin")) {
    poster.push({ href: "/franvaro/regler", label: "Frånvaroregler", ikon: "klocka" });
  }
  if (farSeLonekostnad(user)) {
    poster.push({ href: "/lonekostnad/satser", label: "Satser och löner", ikon: "kontroll" });
  }
  if (hasRole(user, "admin")) {
    poster.push({ href: "/design", label: "Designsystem", ikon: "design" });
  }

  return poster;
}
