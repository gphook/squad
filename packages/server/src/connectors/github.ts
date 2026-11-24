import { isMissing, lastLine, type CliExec } from "./exec.ts";
import { parseAccounts, type ConnectorTemplate } from "./template.ts";

const CODE = /one-time code:\s*([A-Z0-9-]+)/i;
const URL = /(https:\/\/\S+\/login\/device\S*)/;

/** GitHub and GitHub Enterprise Server, through the GitHub CLI (`gh`). */
export function githubTemplate(exec: CliExec): ConnectorTemplate {
  const gh = async (args: string[]) => {
    const r = await exec.run("gh", args);
    if (r.code !== 0) throw new Error(lastLine(r.stdout, r.stderr) || `gh ${args.slice(0, 2).join(" ")} failed.`);
  };
  return {
    id: "github",
    label: "GitHub",
    defaultHost: "github.com",
    cli: { bin: "gh", label: "the GitHub CLI (gh)", installUrl: "https://cli.github.com" },
    async available() {
      try { await exec.run("gh", ["--version"]); return true; } catch (err) { if (isMissing(err)) return false; throw err; }
    },
    async accounts() {
      try {
        // gh writes status to stderr and exits 1 when any host has a problem; the lines still say who is signed in.
        const r = await exec.run("gh", ["auth", "status"]);
        return parseAccounts(`${r.stdout}\n${r.stderr}`, /account|as/);
      } catch (err) {
        if (isMissing(err)) return [];
        throw err;
      }
    },
    signInPlan: (host) => ({
      kind: "device",
      args: ["auth", "login", "--web", "--hostname", host, "--git-protocol", "https"],
      // gh mustn't open a browser itself: the page shows the link in the user's own tab.
      env: { ...process.env, BROWSER: "true" },
    }),
    parseDevice(output) {
      const code = CODE.exec(output)?.[1];
      const url = URL.exec(output)?.[1];
      return code && url ? { code, url } : null;
    },
    afterSignIn: (host) => gh(["auth", "setup-git", "--hostname", host]),
    signOut: (host) => gh(["auth", "logout", "--hostname", host]),
  };
}
