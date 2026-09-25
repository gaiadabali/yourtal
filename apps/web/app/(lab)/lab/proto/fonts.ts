import { Bricolage_Grotesque, Figtree, JetBrains_Mono } from "next/font/google";

export const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
  variable: "--lab-display",
});

export const body = Figtree({ subsets: ["latin"], display: "swap", variable: "--lab-body" });

export const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
  variable: "--lab-mono",
});

export const fontVariables = `${display.variable} ${body.variable} ${mono.variable}`;
