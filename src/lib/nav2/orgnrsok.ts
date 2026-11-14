/**
 * Nav 2.0, Koppla: att hitta en kund på org.nr hur man än skriver det.
 *
 * Varje org.nr i `sales_order` står som 556668-5052 (provet i produktionen 2026-11-14: alla 35). Den som skriver
 * 5566685052 eller 556668 5052 fick "Ingen träff". Bindestrecket kan ligga mellan vilka två siffror som helst i det
 * som skrivits (man kan söka på en bit mitt i numret), så varje plats provas: 5566685052, 5-566685052, …,
 * 556668-5052, …, 556668505-2. Det blir högst tio villkor, och de matchar bara när siffrorna står i följd i numret.
 *
 * Svaret är PostgREST-villkor för `.or()`. Sökordet har redan tvättats från filtrets egna tecken i rutten, och här
 * används bara siffror.
 */
export function orgnrVillkor(sok: string): string[] {
  if (!/^[\d\s-]+$/.test(sok)) return [];
  const siffror = sok.replace(/\D/g, "");
  if (siffror.length < 3 || siffror.length > 10) return [];
  const varianter = [siffror];
  for (let i = 1; i < siffror.length; i++) varianter.push(`${siffror.slice(0, i)}-${siffror.slice(i)}`);
  return varianter.map((x) => `org_number.ilike.%${x}%`);
}
