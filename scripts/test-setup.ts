import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A driver can load the store before its test file runs. Isolate it before any test imports,
// including when the terminal has an override pointing at the user's pairings.
const controlDir = mkdtempSync(join(tmpdir(), "vantage-control-test-"));
process.env["VANTAGE_CONTROL_DIR"] = controlDir;
process.on("exit", () => rmSync(controlDir, { recursive: true, force: true }));
