import type { Region } from "./catalogue";

/**
 * One question per fact the shared demo video shows (same order as `DEMO_FACTS`), written in the
 * campaign's own language. A bank of nine used to be nine copies of "What did the video say?";
 * each now asks about its own fact and names the business, so they read as different questions.
 * Campaign content has one language (the region's), like its title and synopsis; the viewer's
 * display language only translates the chrome around it.
 */
const PROMPTS: Readonly<Record<Region, readonly ((brand: string) => string)[]>> = {
  AU: [
    (brand) => `In the ${brand} video, what is said about when your points unlock?`,
    (brand) => `In the ${brand} video, where do rewards come from?`,
    (brand) => `In the ${brand} video, what do you need to do to earn?`,
  ],
  ID: [
    (brand) => `Di video ${brand}, apa yang dikatakan tentang kapan poin terbuka?`,
    (brand) => `Di video ${brand}, dari mana hadiah berasal?`,
    (brand) => `Di video ${brand}, apa yang perlu dilakukan untuk mendapatkan poin?`,
  ],
};

export function demoQuestionPrompt(region: Region, factIndex: number, brandName: string): string {
  const prompts = PROMPTS[region];
  const prompt = prompts[factIndex % prompts.length];
  return prompt === undefined ? brandName : prompt(brandName);
}
