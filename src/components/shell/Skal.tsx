"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import type { NavItem } from "./nav-items";

export function Skal({
  items,
  namn,
  roll,
  children,
}: {
  items: NavItem[];
  namn: string;
  roll: string;
  children: ReactNode;
}) {
  const [oppen, setOppen] = useState(false);

  return (
    <div className="min-h-dvh">
      <Sidebar
        items={items}
        namn={namn}
        roll={roll}
        oppen={oppen}
        stang={() => setOppen(false)}
      />
      <div className="px-4 lg:pl-[18rem]">
        <Topbar oppnaMeny={() => setOppen(true)} />
        {/* Innehallsyta maximalt 1440 px, centrerad (UI-PRD §6). */}
        <main className="mx-auto max-w-[1440px] pb-16">{children}</main>
      </div>
    </div>
  );
}
