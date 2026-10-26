/**
 * vllm_fleet — the vLLM Fleet inference gateway as a named adapter surface.
 *
 * It is not a separate harness: it drives the same `opencode` binary as
 * `opencode_local`, pinned to the `vllm-fleet` provider declared in
 * PAPERCLIP_OPENCODE_PROVIDERS. The only thing that differs is the model list,
 * so the registry builds it by spreading the OpenCode adapter and replacing
 * that list. Operators used to find these models buried under an OpenCode
 * model prefix; now the gateway is the thing you pick (LOC-657).
 */
import type { AdapterModel } from "@paperclipai/adapter-utils";
import {
  listGatewayProviderModels,
  VLLM_FLEET_PROVIDER_ID,
} from "@paperclipai/adapter-opencode-local/server";

/**
 * Models are read from PAPERCLIP_OPENCODE_PROVIDERS — the same declaration the
 * run path injects into opencode.json. There is deliberately no hardcoded
 * fallback list: a model this adapter offers but the gateway does not serve
 * would be a lie the user only discovers mid-run.
 */
export async function listVllmFleetModels(): Promise<AdapterModel[]> {
  return listGatewayProviderModels(VLLM_FLEET_PROVIDER_ID);
}

export const VLLM_FLEET_AGENT_CONFIGURATION_DOC = `# vllm_fleet agent configuration

Adapter: vllm_fleet

Use when:
- You want the agent's inference served by the vLLM Fleet gateway
- You want the gateway named at the top level instead of hidden behind an
  OpenCode model prefix

Don't use when:
- You want a hosted provider (use opencode_local, claude_local, codex_local)
- The vllm-fleet provider is not declared in PAPERCLIP_OPENCODE_PROVIDERS —
  without it this adapter has no models to offer

Core fields:
- model (string, required): a \`vllm-fleet/<model>\` id declared by the gateway
- cwd (string, optional): default absolute working directory for the agent process
- instructionsFilePath (string, optional): absolute path to a markdown instructions file
- variant (string, optional): reasoning/profile variant passed as --variant
- dangerouslySkipPermissions (boolean, optional): run without approval prompts; defaults to true
- command (string, optional): defaults to "opencode"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Runs execute the OpenCode CLI: opencode run --format json --model vllm-fleet/...
- The available models come from the \`vllm-fleet\` entry in
  PAPERCLIP_OPENCODE_PROVIDERS. Add a model there and it appears here; there is
  no second list to keep in sync.
- \`opencode models\` never enumerates a private gateway, so the model
  availability probe is skipped for declared gateway models.
- The attached AI connection covers billing and authentication only. Inference
  requests go to the gateway's own base URL.
`;
