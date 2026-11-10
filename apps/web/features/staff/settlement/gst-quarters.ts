/** The latest `count` calendar quarters up to and including the one `now` falls in, newest first, as `2026-Q4`. */
export function recentQuarters(now: Date, count: number): string[] {
  let year = now.getUTCFullYear();
  let quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(`${String(year)}-Q${String(quarter)}`);
    quarter -= 1;
    if (quarter === 0) {
      quarter = 4;
      year -= 1;
    }
  }
  return out;
}
