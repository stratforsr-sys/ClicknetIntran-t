"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Bottennav } from "./Bottennav";
import type { NavItem } from "./nav-items";

export function Skal({
  items,
  namn,
  roll,
  stamplingPa,
  children,
}: {
  items: NavItem[];
  namn: string;
  roll: string;
  stamplingPa: boolean;
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
        {/* Innehallsyta maximalt 1440 px, centrerad (UI-PRD §6).
            Under 768 px ligger bottenraden over sidans nederkant, sa
            innehallet behover en botten som ar hogre an raden ar. */}
        <main className="mx-auto max-w-[1440px] pb-28 md:pb-16">{children}</main>
      </div>
      <Bottennav stamplingPa={stamplingPa} oppnaMeny={() => setOppen(true)} />
    </div>
  );
}
