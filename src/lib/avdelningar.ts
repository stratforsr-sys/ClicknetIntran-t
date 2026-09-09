import type { CurrentUser } from "@/lib/auth";
import { ROLES, type Role } from "@/lib/roles";

/**
 * Avdelningarna.
 *
 * ===========================================================================
 * DE ÄR RIKTIGA, MEN DE STÅR ÄNNU INTE I DATABASEN.
 *
 * Företaget har avdelningar på riktigt — försäljning, leverans, ekonomi. Det
 * `employee`-raden bär i dag är ROLLER, och en roll är inte en avdelning: en
 * teamledare och en säljare hör till samma avdelning med olika roller, och en
 * `admin` kan sitta var som helst.
 *
 * Listan ligger därför här, i koden, och avdelningen härleds ur rollen. Det är
 * ett medvetet mellansteg och inte en genväg som glömts bort:
 *
 * - `id` är valda för att kunna bli primärnycklar. Läggs `avdelning` upp som
 *   tabell senare är det de här strängarna som står i den.
 * - `avdelningFor()` är den ENDA platsen där härledningen sker. Den dagen
 *   `employee.avdelning_id` finns byts funktionens kropp — inte menyn, inte
 *   grupperna, inte panelen.
 *
 * Menyn frågar aldrig efter avdelningen för att avgöra vad någon FÅR se. Det
 * gör rollerna, behörigheterna och RLS, precis som förut. Avdelningen avgör
 * bara var en post hamnar och vilken grupp som står vald när chefsvyn öppnas —
 * alltså ordningen på skärmen, aldrig åtkomsten.
 * ===========================================================================
 */
export const AVDELNINGAR = [
  { id: "forsaljning", namn: "Försäljning", ikon: "saljning" },
  { id: "leverans", namn: "Leverans & support", ikon: "support" },
  { id: "ekonomi", namn: "Ekonomi", ikon: "sedel" },
  { id: "personal", namn: "Personal", ikon: "personal" },
  { id: "system", namn: "System", ikon: "installningar" },
] as const;

export type AvdelningId = (typeof AVDELNINGAR)[number]["id"];

/**
 * Rollens hemvist.
 *
 * `Record<Role, …>` och inte en delvis karta med flit: läggs en nionde roll
 * till i `roles.ts` slutar den här filen kompilera tills någon svarat vilken
 * avdelning den hör till. En tyst `undefined` hade i stället gett en person
 * utan hemvist, och det syns inte förrän menyn ser fel ut.
 *
 * `null` betyder "ingen enskild avdelning". VD hör inte till en av dem, och
 * ska inte få försäljning förvalt bara för att det råkar stå först.
 */
const ROLLENS_AVDELNING: Record<Role, AvdelningId | null> = {
  sales_manager: "forsaljning",
  ceo: null,
  team_lead: "forsaljning",
  salesperson: "forsaljning",
  finance: "ekonomi",
  project_manager: "leverans",
  delivery: "leverans",
  admin: "system",
};

/**
 * Personens egen avdelning, eller `null`.
 *
 * DET HÄR ÄR FUNKTIONEN SOM BYTS UT när avdelningen blir ett fält på den
 * anställda. Allt annat i navigeringen läser bara svaret.
 *
 * Ordningen är `ROLES`, inte den ordning rollerna råkar ligga i på raden:
 * en säljchef som också är säljare hör till försäljning oavsett vilken rad
 * databasen returnerade först, och menyn ska inte kunna byta utseende mellan
 * två sidvisningar.
 */
export function avdelningFor(user: CurrentUser | null): AvdelningId | null {
  if (!user) return null;
  for (const roll of ROLES) {
    if (!user.roles.includes(roll)) continue;
    const avdelning = ROLLENS_AVDELNING[roll];
    if (avdelning) return avdelning;
  }
  return null;
}
