/**
 * Slotens tomma lage.
 *
 * Kravs av Next: en parallell rutt som inte matchar nagot maste ha ett
 * `default`, annars far en full sidladdning 404 pa hela sidan i stallet for
 * bara pa sloten. Det ar precis vad som ska handa vid en full laddning av
 * t.ex. /tid/sparrar — da finns ingen interception, och panelen ska ritas som
 * helsida av `children` med rutan tom.
 */
export default function Tom() {
  return null;
}
