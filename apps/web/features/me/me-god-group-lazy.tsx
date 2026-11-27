"use client";

import dynamic from "next/dynamic";

// Below the fold on /me: split out of the first load, which sits at the 200 KB gate.
export const MeGodGroupSection = dynamic(() =>
  import("./me-god-group-section").then((m) => m.MeGodGroupSection),
);
