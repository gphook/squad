/** Squad's command line: the options `squad` / `npx @gphook/squad` and `npm start --` accept. */
export interface CliOptions { port: number; help: boolean; version: boolean; unknown: string[] }

const DEFAULT_PORT = 7340;
/** Flags handled elsewhere (signin/startup.ts) but still valid here. */
const STARTUP_FLAGS = new Set(["--no-open", "--reset-sign-in"]);

const validPort = (s: string | undefined): number | null => {
  if (s === undefined || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : null;
};

/** Port precedence: --port, then SQUAD_PORT, then ~/.squad/config.json, then 7340. */
export function parseCli(argv: string[], env: NodeJS.ProcessEnv, configPort: number | undefined): CliOptions {
  const o: CliOptions = { port: validPort(env.SQUAD_PORT) ?? configPort ?? DEFAULT_PORT, help: false, version: false, unknown: [] };
  let flagPort: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--version" || a === "-v") o.version = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (STARTUP_FLAGS.has(a)) continue;
    else if (a === "--port") {
      const next = argv[i + 1];
      const p = validPort(next);
      if (p === null) o.unknown.push(next === undefined ? a : `${a} ${next}`);
      else flagPort = p;
      if (next !== undefined) i++;
    } else if (a.startsWith("--port=")) {
      const p = validPort(a.slice("--port=".length));
      if (p === null) o.unknown.push(a);
      else flagPort = p;
    } else o.unknown.push(a);
  }
  if (flagPort !== null) o.port = flagPort;
  return o;
}

export function helpText(version: string): string {
  return `Squad ${version} — run a squad of Claude Code agents from your browser

Usage: squad [options]        (or: npx @gphook/squad [options])

Options:
  --port <n>        Port to listen on (default 7340)
  --no-open         Don't open the browser; print the link instead
  --reset-sign-in   Get a fresh setup link to add a passkey
  --version, -v     Print the version
  --help, -h        Print this help

Environment:
  SQUAD_HOME             Data folder (default ~/.squad)
  SQUAD_PORT             Port, when --port isn't given
  SQUAD_NO_OPEN=1        Same as --no-open
  SQUAD_NO_UPDATE_CHECK=1  Don't check npm for a newer version`;
}

export function nodeTooOld(version: string): boolean {
  return Number(version.split(".")[0]) < 24;
}
