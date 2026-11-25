# User dialog kinds

Reference for the Agent SDK's `onUserDialog` / `supportedDialogKinds` (issue #36). Taken from the Claude Code binary
bundled with `@anthropic-ai/claude-agent-sdk` 0.3.330 (`@anthropic-ai/claude-agent-sdk-linux-x64/claude`); the typed
API (`sdk.d.ts`) leaves `dialogKind` an open string and documents only `refusal_fallback_prompt`.

These kinds are internal to Claude Code and can change between versions. Re-check the bundled binary when upgrading
the SDK, e.g.:

```sh
LC_ALL=C grep -aoE 'ds\(\{kind:"[a-z_]+"' node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude | sort -u
```

## Protocol rules

- The CLI only sends a kind that some attached client listed in `supportedDialogKinds`. `onUserDialog` alone opts
  into nothing. Declare only kinds Squad actually renders and answers.
- For a kind Squad didn't declare, return `null` (stay silent). Never answer `{behavior: "cancelled"}`: that settles
  the dialog as if the user dismissed it.
- Answer a declared kind with `{behavior: "completed", result}` or `{behavior: "cancelled"}` (the CLI then applies
  the kind's default). An unanswered dialog is cancelled by the CLI at its deadline (5 minutes by default;
  `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS` overrides).
- Squad currently declares none (`packages/server/src/runner.ts`).

Not every kind below reaches an SDK host as `request_user_dialog`: the permission and MCP kinds probably arrive
through `canUseTool` and `onElicitation`, which Squad already handles. Which kinds are actually sent to SDK hosts
hasn't been traced.

## Likely candidates for Squad

| Kind | Payload | Result | Default |
|---|---|---|---|
| `refusal_fallback_prompt` | `originalModel`, `fallbackModel`, `apiRefusalCategory?`, `guidanceText?`, `retractedMessageUuids?` | `retry_fallback` \| `edit_prompt` \| `cancelled` | `cancelled` (classic refusal error) |
| `fable_overage_consent_prompt` | `overagesEnabled`, `modelName?`, `model?`, `leftOutOf?` (`plan`\|`seat`), `endedOn?`, `member?`, `request?`, `balanceCents?`, `currency?` | `consent` \| `switch_default` \| `request_admin` \| `cancelled` | `cancelled` |
| `sandbox_network_access` | `host`, `port?`, `forwardedFromWorker?`, `workerName?` | `{allow, persistToSettings, persistRow?}` \| `cancelled` | `cancelled` |
| `goal_proposal` | `condition` | `{approved, explicit?}` | `{approved: false}` |
| `device_mcp_consent` | `v`, `machine_name`, `reconsent`, `changed_servers?`, `servers[]` (`name`, `scope`, `transport`, `tool_count`, `tool_names`, `tool_names_truncated`) | `allow` \| `deny` \| `not_now` | `not_now` |
| `ultraplan_launch` | `promptIdentifier`, `showTerms`, `prompt`, `deliveredByRelay` | `run` \| `run_with_upload_notice` \| `cancel` \| `cancelled` | `cancelled` |

## All kinds

| Group | Kinds |
|---|---|
| Model / plan | `refusal_fallback_prompt`, `fable_overage_consent_prompt`, `ultraplan_launch`, `goal_proposal`, `cloud_launch_question` |
| Permissions | `permission_prompt`, `permission_bash`, `permission_file`, `permission_webfetch`, `permission_skill`, `permission_monitor`, `permission_powershell`, `permission_browser`, `permission_workflow`, `permission_enter_plan_mode`, `permission_ask_user_question`, `permission_publish_plugin`, `permission_continue_in_projects`, `computer_use_approval`, `sandbox_network_access` |
| MCP | `mcp_elicitation`, `mcp_url_elicitation`, `mcp_elicitation_waiting`, `device_mcp_consent` |
| Auto mode | `auto_mode_setup_review`, `auto_mode_outside_reads`, `auto_mode_flagged_allow` |
| Continue in Projects | `continue_in_projects_target`, `continue_in_projects_compose`, `continue_in_projects_message`, `continue_in_projects_remote_control` |
| Setup / hints | `chrome_install_setup`, `chrome_install_upsell`, `ide_onboarding`, `lsp_recommendation`, `plugin_hint`, `remote_callout`, `managed_settings_security`, `unattended_serving_consent` |
| Other | `peer_inbound_approval`, `left_arrow_confirm`, `local_jsx` |
