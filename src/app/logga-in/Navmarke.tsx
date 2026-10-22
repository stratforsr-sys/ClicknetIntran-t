/** Ekrarnas ändpunkter, uträknade som i utkastets hubMark(). */
const EKRAR = Array.from({ length: 6 }, (_, k) => {
  const a = (k * Math.PI) / 3 + Math.PI / 6;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    x1: r(16 + Math.cos(a) * 5.2),
    y1: r(16 + Math.sin(a) * 5.2),
    x2: r(16 + Math.cos(a) * 9.4),
    y2: r(16 + Math.sin(a) * 9.4),
  };
});

/**
 * Navet: en ring, sex ekrar och en punkt. Samma märke som i Nav 2.0:s meny.
 *
 * Ekrarna snurrar medan något i kortet väntar på servern (`aria-busy`, se
 * .in-ekrar i inloggning.css). Det är inloggningens enda väntesymbol.
 */
export function Navmarke({ storlek = 30 }: { storlek?: number }) {
  return (
    <svg width={storlek} height={storlek} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12" fill="none" stroke="var(--n-hub-brand)" strokeWidth="2" />
      <g className="in-ekrar" stroke="var(--n-hub-ink)" strokeWidth="2" strokeLinecap="round">
        {EKRAR.map((e, i) => (
          <line key={i} {...e} />
        ))}
      </g>
      <circle className="in-nav" cx="16" cy="16" r="3" fill="var(--n-hub-signal)" />
    </svg>
  );
}
