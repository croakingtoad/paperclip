import type { UIAdapterModule } from "../types";
import { parseOpenCodeStdoutLine } from "@paperclipai/adapter-opencode-local/ui";
import { buildOpenCodeLocalConfig } from "@paperclipai/adapter-opencode-local/ui";
import { VllmLocalConfigFields } from "./config-fields";

export const vllmLocalUIAdapter: UIAdapterModule = {
  type: "vllm_local",
  label: "VLLM Fleet",
  parseStdoutLine: parseOpenCodeStdoutLine,
  ConfigFields: VllmLocalConfigFields,
  buildAdapterConfig: buildOpenCodeLocalConfig,
};
