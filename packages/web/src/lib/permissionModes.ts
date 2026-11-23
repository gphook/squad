import type { PermissionMode } from "@squad/shared";

export interface PermissionModeOption {
  value: PermissionMode;
  label: string;
  description: string;
}

/** The SDK's permission modes in plain words, safest first. */
export const PERMISSION_MODE_OPTIONS: PermissionModeOption[] = [
  { value: "plan", label: "Plan only", description: "Squadmates read and plan, but change nothing." },
  { value: "default", label: "Ask before changes", description: "You approve each file edit and command." },
  { value: "acceptEdits", label: "Auto-accept edits", description: "File edits go ahead; you approve commands." },
  { value: "bypassPermissions", label: "Skip all approvals", description: "Everything runs without asking. Use with care." },
];
