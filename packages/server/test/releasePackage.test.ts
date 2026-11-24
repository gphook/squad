import { describe, it, expect } from "vitest";
import { releasePackageJson } from "../../../scripts/releasePackage.ts";

const root = { name: "squad", version: "1.2.3", description: "Run Squad", license: "MIT", repository: { type: "git", url: "https://github.com/gphook/squad.git" } };
const server = {
  name: "@squad/server",
  dependencies: { "@anthropic-ai/claude-agent-sdk": "0.3.330", fastify: "^5.6.1", "@squad/shared": "*", tsx: "^4.20.6", ws: "^8.18.3", zod: "^4.1.12" },
};

describe("releasePackageJson", () => {
  const pkg = releasePackageJson(root, server);
  it("names and versions the published package from the repo root", () => {
    expect(pkg).toMatchObject({
      name: "@gphook/squad", version: "1.2.3", description: "Run Squad", license: "MIT", type: "module",
      repository: root.repository, bin: { squad: "bin/squad.js" }, engines: { node: ">=24" }, files: ["bin", "dist", "web", "kit"],
    });
  });
  it("depends on the server's runtime packages, without tsx or the bundled workspaces", () => {
    expect(pkg.dependencies).toEqual({ "@anthropic-ai/claude-agent-sdk": "0.3.330", fastify: "^5.6.1", ws: "^8.18.3", zod: "^4.1.12" });
  });
});
