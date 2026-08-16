import type { CurrentUser } from "@/lib/auth";
import { canManageEmployees, hasRole } from "@/lib/auth";

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
