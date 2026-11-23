import { basename } from "node:path";

/** How a `$ cmd` becomes a shell invocation, per shell family. */
export type ShellId = "posix" | "fish" | "nu" | "pwsh";

export interface ShellAdapter {
  id: ShellId;
  /** Program names (the basename of `$SHELL`) this adapter handles. */
  names: string[];
  argv(command: string): string[];
}

const dashC = (command: string) => ["-c", command];

export const ADAPTERS: ShellAdapter[] = [
  { id: "posix", names: ["sh", "bash", "rbash", "zsh", "dash", "ash", "ksh", "ksh93", "mksh", "yash", "posh"], argv: dashC },
  { id: "fish", names: ["fish"], argv: dashC },
  { id: "nu", names: ["nu"], argv: dashC },
  { id: "pwsh", names: ["pwsh", "powershell"], argv: (command) => ["-NoProfile", "-NonInteractive", "-Command", command] },
];

export interface ResolvedShell {
  adapter: ShellAdapter;
  path: string;
  /** For display, e.g. "zsh". */
  name: string;
}

const FALLBACK: ResolvedShell = { adapter: ADAPTERS[0], path: "/bin/sh", name: "sh" };

/** The shell a `$SHELL` value names; unset, empty or unrecognised falls back to /bin/sh. */
export function resolveShell(shellEnv: string | undefined): ResolvedShell {
  if (!shellEnv) return FALLBACK;
  const name = basename(shellEnv);
  const adapter = ADAPTERS.find((a) => a.names.includes(name));
  return adapter ? { adapter, path: shellEnv, name } : FALLBACK;
}

/** The user's shell, from `$SHELL` as Squad sees it now. */
export const userShell = (): ResolvedShell => resolveShell(process.env.SHELL);
