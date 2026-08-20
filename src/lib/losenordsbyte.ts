/**
 * Namnet pa flaggan som tvingar fram ett losenordsbyte.
 *
 * Den bor i auth-kontots `app_metadata` och inte i `employee`. Tva skal:
 *
 *   1. `app_metadata` far bara skrivas med service role. `user_metadata` far
 *      anvandaren sjalv andra — en spa­rr som den sparrade kan stanga av ar
 *      ingen spa­rr.
 *   2. Mellanvaran har redan svaret. `getUser()` kors pa varje sidladdning
 *      anda, och flaggan foljer med i det svaret. En kolumn i `employee` hade
 *      kostat en databasfraga per sidvisning for hela navet.
 *
 * Egen fil, och inte en konstant i mellanvaran, for att bade servern och
 * spa­rren ska lasa samma strang. Ett stavfel pa ena stallet skulle annars
 * betyda att tvanget aldrig gar bort.
 */
export const FLAGGA = "byt_losenord";

/** Sidan dar bytet sker. Undantagen i mellanvaran pekar hit. */
export const BYTESVAG = "/byt-losenord";

/**
 * Kraver det har kontot ett byte?
 *
 * Endast `=== true` raknas. Ett saknat falt, `null` eller strangen "false"
 * ska inte las­a ute nagon — en spa­rr som utloses av att ett falt saknas
 * las­er ute alla som fanns fore den byggdes.
 */
export function kraverByte(appMetadata: Record<string, unknown> | undefined | null): boolean {
  return appMetadata?.[FLAGGA] === true;
}
