import { isMissing, lastLine, type CliExec } from "./exec.ts";
import { parseAccounts, type ConnectorTemplate } from "./template.ts";

const CODE = /one-time code:\s*([A-Z0-9-]+)/i;
const URL = /authorize:\s*(https:\/\/\S+)/i;
const GIT_ARGS = ["--git-protocol", "https", "--setup-git-credential-helper"];

/** glab stores tokens in plain text when it thinks it's in CI; Squad's own CLI runs set CI, so drop it. */
function glabEnv(): NodeJS.ProcessEnv {
  const { CI: _ci, GITLAB_CI: _gci, ...env } = process.env;
  return env;
}

/** gitlab.com and self-managed GitLab, through the GitLab CLI (`glab`). */
export function gitlabTemplate(exec: CliExec): ConnectorTemplate {
  const glab = async (args: string[], stdin?: string) => {
    const r = await exec.run("glab", args, { env: glabEnv(), stdin });
    if (r.code !== 0) throw new Error(lastLine(r.stdout, r.stderr) || `glab ${args.slice(0, 2).join(" ")} failed.`);
    return r;
  };
  const accounts = async () => {
    try {
      const r = await exec.run("glab", ["auth", "status"], { env: glabEnv() });
      return parseAccounts(`${r.stdout}\n${r.stderr}`, /as/);
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  };
  return {
    id: "gitlab",
    label: "GitLab",
    defaultHost: "gitlab.com",
    cli: { bin: "glab", label: "the GitLab CLI (glab)", installUrl: "https://gitlab.com/gitlab-org/cli#installation" },
    async available() {
      try { await exec.run("glab", ["--version"], { env: glabEnv() }); return true; } catch (err) { if (isMissing(err)) return false; throw err; }
    },
    accounts,
    // Only gitlab.com has an OAuth app glab can use without an admin registering one, so other hosts take a token.
    signInPlan: (host) => (host === "gitlab.com"
      ? { kind: "device", args: ["auth", "login", "--hostname", host, "--device", ...GIT_ARGS], env: glabEnv() }
      : { kind: "token", tokenUrl: `https://${host}/-/user_settings/personal_access_tokens?name=Squad&scopes=read_repository,read_api` }),
    parseDevice(output) {
      const code = CODE.exec(output)?.[1];
      const url = URL.exec(output)?.[1];
      return code && url ? { code, url } : null;
    },
    async tokenSignIn(host, token) {
      await glab(["auth", "login", "--hostname", host, "--stdin", ...GIT_ARGS], token);
      // glab stores a token GitLab rejects and still exits 0, so check it took.
      if (!(await accounts()).some((a) => a.host === host)) {
        await glab(["auth", "logout", "--hostname", host]).catch(() => {});
        throw new Error("GitLab didn't accept that token.");
      }
    },
    afterSignIn: async () => {},
    signOut: async (host) => { await glab(["auth", "logout", "--hostname", host]); },
  };
}
