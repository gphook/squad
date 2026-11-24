/** The published package's package.json, generated from the repo's so versions and dependencies can't drift. */
interface Pkg { version?: string; description?: string; license?: string; repository?: unknown; dependencies?: Record<string, string> }

export function releasePackageJson(rootPkg: Pkg, serverPkg: Pkg) {
  const dependencies = Object.fromEntries(
    Object.entries(serverPkg.dependencies ?? {}).filter(([name]) => name !== "tsx" && !name.startsWith("@squad/")),
  );
  return {
    name: "@gphook/squad",
    version: rootPkg.version,
    description: rootPkg.description,
    license: rootPkg.license,
    repository: rootPkg.repository,
    type: "module",
    bin: { squad: "bin/squad.js" },
    engines: { node: ">=24" },
    files: ["bin", "dist", "web", "kit"],
    dependencies,
  };
}
