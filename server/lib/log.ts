type Level = "info" | "warn" | "error";
type Meta = Record<string, unknown>;

function emit(level: Level, msg: string, meta: Meta = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, meta?: Meta) => emit("info", msg, meta),
  warn: (msg: string, meta?: Meta) => emit("warn", msg, meta),
  error: (msg: string, meta?: Meta) => emit("error", msg, meta),
};
