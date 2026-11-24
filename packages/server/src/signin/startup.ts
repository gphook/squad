import { spawn } from "node:child_process";

export interface StartupOptions { noOpen: boolean; resetSignIn: boolean; dev: boolean }

export function parseStartupArgs(argv: string[], env: NodeJS.ProcessEnv): StartupOptions {
  return {
    noOpen: argv.includes("--no-open") || env.SQUAD_NO_OPEN === "1",
    resetSignIn: argv.includes("--reset-sign-in"),
    dev: env.SQUAD_DEV === "1",
  };
}

export function startupPlan(o: StartupOptions, passkeyCount: number): { mintCode: boolean; open: boolean } {
  return { mintCode: passkeyCount === 0 || o.resetSignIn, open: !o.noOpen && !o.dev };
}

export function startupMessage(port: number, code: string | null, opened: boolean): string {
  if (code === null) return `Squad: http://localhost:${port}/`;
  if (opened) return `Squad: opened http://localhost:${port}/ in your browser to set up sign-in.`;
  return `Squad: set up sign-in at http://localhost:${port}/setup?code=${code}  (single use, expires in 10 minutes)`;
}

export function openBrowser(url: string, spawnFn: typeof spawn = spawn): Promise<boolean> {
  const cmd = process.platform === "linux" ? "xdg-open" : process.platform === "darwin" ? "open" : null;
  if (!cmd) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const child = spawnFn(cmd, [url], { detached: true, stdio: "ignore" });
      child.once("error", () => resolve(false));
      child.once("spawn", () => { child.unref(); resolve(true); });
    } catch {
      resolve(false);
    }
  });
}
