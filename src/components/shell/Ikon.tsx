/** Enhetlig strecktjocklek. AC-U2.6: ingen skugga pa ikoner. */
const P: Record<string, string> = {
  hem: "M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5",
  personal: "M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-1.5a4 4 0 0 0-3-3.87M16.5 3.63a4 4 0 0 1 0 7.75",
  logg: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5",
  design: "M12 3v18M3 12h18M7.5 7.5l9 9M16.5 7.5l-9 9",
  sok: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35",
  klocka: "M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.73 21a2 2 0 0 1-3.46 0",
  ut: "M15 17l5-5-5-5M20 12H9M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6",
  meny: "M4 7h16M4 12h16M4 17h16",
  tillbaka: "M19 12H5M11 18l-6-6 6-6",
  plus: "M12 5v14M5 12h14",
  kontroll: "M20 6 9 17l-5-5",
  rutiner: "M6 3h9l5 5v13H6zM15 3v5h5M9.5 13h6M9.5 17h4",
  tid: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2",
  utbildning: "M3 8.5 12 4l9 4.5-9 4.5zM7 11v5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-5M20 9.5V15",
  varning: "M12 9v4M12 17h.01M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3.1L13.7 3.9a2 2 0 0 0-3.4 0Z",
};

export function Ikon({ namn, className = "size-5" }: { namn: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={P[namn] ?? P.hem} />
    </svg>
  );
}
