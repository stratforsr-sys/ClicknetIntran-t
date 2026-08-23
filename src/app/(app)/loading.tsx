/**
 * Laddningsgransen for allt bakom inloggningen.
 *
 * ===========================================================================
 * VARFOR DEN BEHOVS
 *
 * Utan en `loading.tsx` gor ett klick i menyn INGENTING synligt forran servern
 * ar helt fardig med nasta sida. Skarmen star still, den gamla sidan ligger
 * kvar, och den som klickade vet inte om navet tog emot trycket eller inte —
 * sa hen klickar igen. Det ar den upplevelsen som beskrivs som att navet
 * "hanger sig", och den beror inte pa hur lang tid sidan tar utan pa att
 * ingenting hander under tiden.
 *
 * Med den har filen far Next en gräns att visa direkt vid navigering. Skalet —
 * sidopanel, topprad, bottenrad — star kvar och ritas aldrig om; det ar bara
 * innehallsytan som byts mot det harnedan. Aterkopplingen blir omedelbar aven
 * nar svaret dröjer.
 *
 * DEN GOR OCKSA SIDORNA SNABBARE PA RIKTIGT, inte bara till kanslan. En rutt
 * med en laddningsgrans far Next att forladda gransen nar en lank kommer i
 * sikte, och sjalva sidan far stromma i stallet for att hallas tillbaka tills
 * varenda fraga ar besvarad.
 * ===========================================================================
 *
 * Formen ar med flit trakig och innehallslos. Ett skelett som gissar vad som
 * kommer — tre kort har, en tabell dar — har fel pa de flesta sidor, och ett
 * skelett som visar fel form ar ett hopp till nar det ratta kommer. Det har ar
 * tva rader och tre ytor i sidans egen rytm, och det stammer overallt.
 */
export default function Laddar() {
  return (
    <div className="flex flex-col gap-4 pt-2" role="status" aria-busy="true">
      <span className="sr-only">Sidan laddas</span>

      {/* Rubrikraden. Samma mått som en riktig sidrubrik med underrad. */}
      <div>
        <div className="h-8 w-56 max-w-[70%] animate-pulse rounded-sm bg-ink-300/25" />
        <div className="mt-2 h-4 w-80 max-w-[85%] animate-pulse rounded-sm bg-ink-300/20" />
      </div>

      {/* Tre ytor i kortens form: samma radie, samma hojd, samma elevation. */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-md bg-surface p-4 shadow-elev-1 md:p-6"
          // Trappan gor att ytorna inte pulsar i takt. En vagg som blinkar
          // samtidigt drar till sig blicken; en forskjutning laser som arbete.
          style={{ animationDelay: `${i * 120}ms` }}
        >
          <div className="h-5 w-40 animate-pulse rounded-sm bg-ink-300/25" />
          <div className="mt-3 h-4 w-full animate-pulse rounded-sm bg-ink-300/15" />
          <div className="mt-2 h-4 w-[78%] animate-pulse rounded-sm bg-ink-300/15" />
        </div>
      ))}
    </div>
  );
}
