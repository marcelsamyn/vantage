import { z } from "zod";

const Environment = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4747),
  VANTAGE_LOCAL: z.enum(["0", "1"]).default("0"),
  VANTAGE_ORIGIN: z.url().optional(),
});

export function serverConfig(env: Record<string, string | undefined>): { port: number; hostname: string; origin?: string } {
  const value = Environment.parse(env);
  const url = value.VANTAGE_ORIGIN ? new URL(value.VANTAGE_ORIGIN) : undefined;
  if (url && (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)) {
    throw new Error("VANTAGE_ORIGIN must be an http(s) origin, for example https://vantage.example.com");
  }
  if (url && value.VANTAGE_LOCAL === "1") throw new Error("VANTAGE_ORIGIN cannot be used with VANTAGE_LOCAL=1. Run local features on loopback with Tailscale Serve.");
  return { port: value.PORT, hostname: url ? "0.0.0.0" : "127.0.0.1", origin: url?.origin };
}
