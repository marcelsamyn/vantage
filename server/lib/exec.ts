import { HttpError } from "./http";

export interface RunOptions {
  timeoutMs?: number;
  /** Accept a non-zero exit code when the command still printed output (e.g. `arp` with partial results). */
  allowFailure?: boolean;
  /** Extra environment variables for this command. */
  env?: Record<string, string>;
}

/** Run a local command without a shell and return its stdout. Arguments are passed as an array, never interpolated. */
export async function run(cmd: [string, ...string[]], { timeoutMs = 10_000, allowFailure = false, env = {} }: RunOptions = {}): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env, LC_ALL: "C" } });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (proc.signalCode) throw new HttpError(504, "command_timeout", `${cmd[0]} did not finish within ${Math.round(timeoutMs / 1000)} s`);
  if (code !== 0 && !(allowFailure && stdout)) {
    throw new HttpError(500, "command_failed", `${cmd[0]} exited with code ${code}: ${stderr.trim().slice(0, 200)}`);
  }
  return stdout;
}

/** Spawn a long-running command and yield its stdout line by line. Killing happens when the consumer stops. */
export async function* lines(cmd: [string, ...string[]], { timeoutMs = 60_000 }: { timeoutMs?: number } = {}): AsyncGenerator<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", env: { ...process.env, LC_ALL: "C" } });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        yield buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
      }
    }
    if (buffer) yield buffer;
  } finally {
    clearTimeout(timer);
    proc.kill();
  }
}
