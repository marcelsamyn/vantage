export interface ProbeResult {
  /** Plugin that declared the probe ("core" for the kernel). */
  plugin: string;
  name: string;
  ok: boolean;
  ms: number;
  detail: string | null;
}

export interface HealthReport {
  ok: true;
  startedAt?: string;
  probes: ProbeResult[];
}
