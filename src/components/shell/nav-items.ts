import type { CurrentUser } from "@/lib/auth";
import { canManageEmployees, hasRole } from "@/lib/auth";
import { M2_AKTIV } from "@/lib/tid";

export type NavItem = {
  href: string;
  label: string;
  ikon: string;
  raknare?: number;
};

/**
 * Sidopanelen visar bara moduler som faktiskt ar byggda. Dodlankar med
 * "kommer snart" ar samre an en kort meny — de larr anvandaren att menyn ljuger.
 * Listan vaxer nar varje modul levereras.
 */
export function navFor(user: CurrentUser | null): NavItem[] {
  const items: NavItem[] = [{ href: "/", label: "Hem", ikon: "hem" }];

  // Rutiner ligger overst efter Hem: det ar den vy alla anstallda har arende
  // till, till skillnad fran personal- och adminvyerna nedanfor.
  if (user?.employee) {
    items.push({ href: "/rutiner", label: "Rutiner", ikon: "rutiner" });
    items.push({ href: "/utbildning", label: "Utbildning", ikon: "utbildning" });
    // K12: posten dyker upp forst nar modulen slas pa. En meny som pekar pa en
    // funktion som inte far anvandas ar samre an ingen post alls.
    if (M2_AKTIV) items.push({ href: "/tid", label: "Tid", ikon: "tid" });
  }

  // Loneunderlaget ar ledningens och ekonomins (AC-2.13). Teamledaren har
  // avvikelsevyn, inte den har. Posten foljer M2: utan stampling finns inget
  // underlag att rapportera.
  if (M2_AKTIV && hasRole(user, "sales_manager", "ceo", "finance", "admin")) {
    items.push({ href: "/tid/lonerapport", label: "Lönerapport", ikon: "klocka" });
  }

  if (canManageEmployees(user) || hasRole(user, "ceo", "team_lead")) {
    items.push({ href: "/personal", label: "Personal", ikon: "personal" });
  }
  if (hasRole(user, "sales_manager", "ceo", "admin")) {
    items.push({ href: "/logg", label: "Händelselogg", ikon: "logg" });
  }
  if (hasRole(user, "admin")) {
    items.push({ href: "/design", label: "Designsystem", ikon: "design" });
  }

  return items;
}
