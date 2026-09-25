import { Prototype } from "../proto/prototype";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string }>;
}) {
  const { theme } = await searchParams;
  return <Prototype variant="daylight" theme={theme === "dark" ? "dark" : "light"} />;
}
