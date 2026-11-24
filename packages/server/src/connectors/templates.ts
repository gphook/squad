import type { ConnectorTemplateId } from "@squad/shared";
import type { CliExec } from "./exec.ts";
import { githubTemplate } from "./github.ts";
import { gitlabTemplate } from "./gitlab.ts";
import type { ConnectorTemplate } from "./template.ts";

export { sourceHost } from "./template.ts";
export type { ConnectorTemplate } from "./template.ts";

export function makeTemplates(exec: CliExec): Record<ConnectorTemplateId, ConnectorTemplate> {
  return { github: githubTemplate(exec), gitlab: gitlabTemplate(exec) };
}
