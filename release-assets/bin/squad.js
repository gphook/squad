#!/usr/bin/env node
// Squad's command. Plain, old-style JavaScript on purpose: it must run on any Node to tell people on an older one
// what they need, before the server bundle (which needs Node 24) is loaded.
var major = Number(process.versions.node.split(".")[0]);
if (major < 24) {
  console.error("Squad needs Node 24 or later (you have " + process.versions.node + ").");
  process.exit(1);
}
import("../dist/server.js");
