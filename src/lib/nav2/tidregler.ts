/**
 * Nav 2.0 (0094): regler för Tid som både vyn, rutten och jobben läser.
 *
 * SCHEMA_KVITTENS_FRAN: ett schema som börjar gälla detta datum eller senare
 * bedöms inte för sen ankomst förrän personen tryckt "Jag har sett det".
 * Äldre scheman har ingen kvittens att vänta på. Regeln verkar bara när
 * `SKRIVLAGE.tid` är på.
 */
export const SCHEMA_KVITTENS_FRAN = "2026-10-16";


/** Påminn mig: minuter efter schemats start respektive slut. */
export const PAMINN_MINUTER = [5, 10, 15] as const;

export type Paminn = { in: { pa: boolean; min: number }; ut: { pa: boolean; min: number } };
/** Som repots dagtidsjobb: instämplingen påminns efter 15 minuter. Utstämplingen är avslagen tills man väljer. */
export const PAMINN_STANDARD: Paminn = { in: { pa: true, min: 15 }, ut: { pa: false, min: 15 } };
