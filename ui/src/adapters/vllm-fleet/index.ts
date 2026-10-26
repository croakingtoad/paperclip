import type { UIAdapterModule } from "../types";
import {
  parseOpenCodeStdoutLine,
  buildOpenCodeLocalConfig,
} from "@paperclipai/adapter-opencode-local/ui";
import { OpenCodeLocalConfigFields } from "../opencode-local/config-fields";

// vllm_fleet runs the same opencode binary against the vllm-fleet gateway, so
// its transcript format and config surface are OpenCode's. Only the name the
// operator picks differs.
export const vllmFleetUIAdapter: UIAdapterModule = {
  type: "vllm_fleet",
  label: "vLLM Fleet",
  parseStdoutLine: parseOpenCodeStdoutLine,
  ConfigFields: OpenCodeLocalConfigFields,
  buildAdapterConfig: buildOpenCodeLocalConfig,
};
