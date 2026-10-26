import { afterEach, describe, expect, it, vi } from "vitest";
import * as serverUtils from "@paperclipai/adapter-utils/server-utils";
import {
  discoverOpenCodeModels,
  ensureOpenCodeModelConfiguredAndAvailable,
  listGatewayProviderModels,
  listOpenCodeModels,
  requireOpenCodeModelId,
  resetOpenCodeModelsCacheForTests,
  VLLM_FLEET_PROVIDER_ID,
} from "./models.js";

describe("openCode models", () => {
  afterEach(() => {
    delete process.env.PAPERCLIP_OPENCODE_COMMAND;
    delete process.env.OPENCODE_ALLOW_ALL_MODELS;
    delete process.env.PAPERCLIP_OPENCODE_PROVIDERS;
    resetOpenCodeModelsCacheForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns an empty list when discovery command is unavailable", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND =
      "__paperclip_missing_opencode_command__";
    await expect(listOpenCodeModels()).resolves.toEqual([]);
  });

  it("lists models declared in PAPERCLIP_OPENCODE_PROVIDERS even when discovery cannot run", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND =
      "__paperclip_missing_opencode_command__";
    process.env.PAPERCLIP_OPENCODE_PROVIDERS = JSON.stringify({
      "eu-gateway": {
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: "http://gateway.example/v1",
          apiKey: "{env:EU_GATEWAY_API_KEY}",
        },
        models: { "qwen3.8-27b": {}, "gemma-4-coder": {} },
      },
    });
    await expect(listOpenCodeModels()).resolves.toEqual([
      { id: "eu-gateway/gemma-4-coder", label: "eu-gateway/gemma-4-coder" },
      { id: "eu-gateway/qwen3.8-27b", label: "eu-gateway/qwen3.8-27b" },
    ]);
  });

  it("unions declared gateway models with discovered ones without duplicating", async () => {
    vi.spyOn(serverUtils, "runChildProcess").mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "openai/gpt-5\neu-gateway/qwen3.8-27b\n",
      stderr: "",
      pid: 1,
      startedAt: new Date().toISOString(),
    });
    process.env.PAPERCLIP_OPENCODE_PROVIDERS = JSON.stringify({
      "eu-gateway": { models: { "qwen3.8-27b": {}, "bonsai-27b": {} } },
    });
    await expect(listOpenCodeModels()).resolves.toEqual([
      { id: "eu-gateway/bonsai-27b", label: "eu-gateway/bonsai-27b" },
      { id: "eu-gateway/qwen3.8-27b", label: "eu-gateway/qwen3.8-27b" },
      { id: "openai/gpt-5", label: "openai/gpt-5" },
    ]);
  });

  it("omits vllm-fleet models from the OpenCode list — the vllm_fleet adapter owns them", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND =
      "__paperclip_missing_opencode_command__";
    process.env.PAPERCLIP_OPENCODE_PROVIDERS = JSON.stringify({
      "vllm-fleet": { models: { "qwen3.8-27b": {} } },
      "eu-gateway": { models: { "bonsai-27b": {} } },
    });
    await expect(listOpenCodeModels()).resolves.toEqual([
      { id: "eu-gateway/bonsai-27b", label: "eu-gateway/bonsai-27b" },
    ]);
  });

  it("offers exactly the declared models of the requested gateway provider", () => {
    process.env.PAPERCLIP_OPENCODE_PROVIDERS = JSON.stringify({
      "vllm-fleet": { models: { "qwen3.8-27b": {}, "gemma-4-coder": {} } },
      "eu-gateway": { models: { "bonsai-27b": {} } },
    });
    expect(listGatewayProviderModels(VLLM_FLEET_PROVIDER_ID)).toEqual([
      { id: "vllm-fleet/qwen3.8-27b", label: "vllm-fleet/qwen3.8-27b" },
      { id: "vllm-fleet/gemma-4-coder", label: "vllm-fleet/gemma-4-coder" },
    ]);
  });

  it("offers no models when the gateway is not declared, rather than a stale hardcoded list", () => {
    delete process.env.PAPERCLIP_OPENCODE_PROVIDERS;
    expect(listGatewayProviderModels(VLLM_FLEET_PROVIDER_ID)).toEqual([]);
  });

  it("does not treat a provider id prefix as a match", () => {
    process.env.PAPERCLIP_OPENCODE_PROVIDERS = JSON.stringify({
      "vllm-fleet-staging": { models: { "qwen3.8-27b": {} } },
    });
    expect(listGatewayProviderModels(VLLM_FLEET_PROVIDER_ID)).toEqual([]);
  });

  it("ignores a malformed PAPERCLIP_OPENCODE_PROVIDERS instead of failing the dropdown", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND =
      "__paperclip_missing_opencode_command__";
    process.env.PAPERCLIP_OPENCODE_PROVIDERS = "not json";
    await expect(listOpenCodeModels()).resolves.toEqual([]);
  });

  it("rejects when model is missing", async () => {
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({ model: "" }),
    ).rejects.toThrow("OpenCode requires `adapterConfig.model`");
  });

  it("accepts a provider/model id without running discovery", () => {
    expect(requireOpenCodeModelId("openai/gpt-5.2-codex")).toBe(
      "openai/gpt-5.2-codex",
    );
  });

  it("rejects malformed provider/model ids before discovery", () => {
    expect(() => requireOpenCodeModelId("gpt-5.2-codex")).toThrow(
      "OpenCode requires `adapterConfig.model`",
    );
    expect(() => requireOpenCodeModelId("openai/")).toThrow(
      "OpenCode requires `adapterConfig.model`",
    );
  });

  it("proceeds with the configured model when discovery cannot run (probe is best-effort, never fatal)", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND =
      "__paperclip_missing_opencode_command__";
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "openai/gpt-5",
      }),
    ).resolves.toEqual([{ id: "openai/gpt-5", label: "openai/gpt-5" }]);
  });

  it("skips the availability check when OPENCODE_ALLOW_ALL_MODELS is set in the run env", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND =
      "__paperclip_missing_opencode_command__";
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "anthropic/tensorix/deepseek/deepseek-chat-v3.1",
        env: { OPENCODE_ALLOW_ALL_MODELS: "true" },
      }),
    ).resolves.toEqual([
      {
        id: "anthropic/tensorix/deepseek/deepseek-chat-v3.1",
        label: "anthropic/tensorix/deepseek/deepseek-chat-v3.1",
      },
    ]);
  });

  it("honours OPENCODE_ALLOW_ALL_MODELS from the process env", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND =
      "__paperclip_missing_opencode_command__";
    process.env.OPENCODE_ALLOW_ALL_MODELS = "1";
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "anthropic/gateway/some-model",
      }),
    ).resolves.toEqual([
      {
        id: "anthropic/gateway/some-model",
        label: "anthropic/gateway/some-model",
      },
    ]);
  });

  it("accepts a declared gateway model the discovery probe cannot see", async () => {
    // `opencode models` enumerates models.dev and never a private gateway, so a
    // probe that lists real models but omits the declared one is not evidence
    // of a misconfiguration. Without this the agent cannot run at all.
    vi.spyOn(serverUtils, "runChildProcess").mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "openai/gpt-5\n",
      stderr: "",
      pid: 1,
      startedAt: new Date().toISOString(),
    });
    process.env.PAPERCLIP_OPENCODE_PROVIDERS = JSON.stringify({
      "vllm-fleet": { models: { "qwen3.8-27b": {} } },
    });
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "vllm-fleet/qwen3.8-27b",
      }),
    ).resolves.toEqual([
      { id: "vllm-fleet/qwen3.8-27b", label: "vllm-fleet/qwen3.8-27b" },
    ]);
  });

  it("reads declared providers from the run env in preference to the process env", async () => {
    vi.spyOn(serverUtils, "runChildProcess").mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "openai/gpt-5\n",
      stderr: "",
      pid: 1,
      startedAt: new Date().toISOString(),
    });
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "vllm-fleet/qwen3.8-27b",
        env: {
          PAPERCLIP_OPENCODE_PROVIDERS: JSON.stringify({
            "vllm-fleet": { models: { "qwen3.8-27b": {} } },
          }),
        },
      }),
    ).resolves.toEqual([
      { id: "vllm-fleet/qwen3.8-27b", label: "vllm-fleet/qwen3.8-27b" },
    ]);
  });

  it("still rejects an undeclared model the probe does not list", async () => {
    vi.spyOn(serverUtils, "runChildProcess").mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "openai/gpt-5\n",
      stderr: "",
      pid: 1,
      startedAt: new Date().toISOString(),
    });
    process.env.PAPERCLIP_OPENCODE_PROVIDERS = JSON.stringify({
      "vllm-fleet": { models: { "qwen3.8-27b": {} } },
    });
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "vllm-fleet/not-served",
      }),
    ).rejects.toThrow("Configured OpenCode model is unavailable");
  });

  it("still enforces provider/model format when OPENCODE_ALLOW_ALL_MODELS is set", async () => {
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "not-a-valid-id",
        env: { OPENCODE_ALLOW_ALL_MODELS: "true" },
      }),
    ).rejects.toThrow("OpenCode requires `adapterConfig.model`");
  });

  it("retries a transient `opencode models` failure with backoff before succeeding", async () => {
    vi.useFakeTimers();
    const spy = vi
      .spyOn(serverUtils, "runChildProcess")
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "queued behind another opencode run",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: null,
        signal: null,
        timedOut: true,
        stdout: "",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "ollama/qwen2.5-coder:7b\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      });

    const promise = discoverOpenCodeModels();
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual([
      { id: "ollama/qwen2.5-coder:7b", label: "ollama/qwen2.5-coder:7b" },
    ]);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("refreshes a stale non-empty catalog before rejecting the configured model", async () => {
    const spy = vi
      .spyOn(serverUtils, "runChildProcess")
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "openrouter/example/stale-model\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "Models cache refreshed\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout:
          "openrouter/example/current-model\nopenrouter/deepseek/deepseek-v4-flash-0731\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      });

    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "openrouter/deepseek/deepseek-v4-flash-0731",
      }),
    ).resolves.toContainEqual({
      id: "openrouter/deepseek/deepseek-v4-flash-0731",
      label: "openrouter/deepseek/deepseek-v4-flash-0731",
    });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0]?.[2]).toEqual(["models"]);
    expect(spy.mock.calls[1]?.[2]).toEqual(["models", "--refresh"]);
    expect(spy.mock.calls[2]?.[2]).toEqual(["models"]);
  });

  it("still rejects when a refreshed non-empty catalog omits the configured model", async () => {
    const spy = vi
      .spyOn(serverUtils, "runChildProcess")
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "openrouter/example/stale-model\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "Models cache refreshed\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "openrouter/example/current-model\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      });

    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "openrouter/deepseek/deepseek-v4-flash-0731",
      }),
    ).rejects.toThrow(
      "Configured OpenCode model is unavailable: openrouter/deepseek/deepseek-v4-flash-0731",
    );
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[1]?.[2]).toEqual(["models", "--refresh"]);
    expect(spy.mock.calls[2]?.[2]).toEqual(["models"]);
  });

  it("still rejects from the original catalog when post-refresh enumeration returns no models", async () => {
    const spy = vi
      .spyOn(serverUtils, "runChildProcess")
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "openrouter/example/stale-model\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "Models cache refreshed\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      });

    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "openrouter/deepseek/deepseek-v4-flash-0731",
      }),
    ).rejects.toThrow("Available models: openrouter/example/stale-model");
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[1]?.[2]).toEqual(["models", "--refresh"]);
    expect(spy.mock.calls[2]?.[2]).toEqual(["models"]);
  });

  it("still rejects from the original catalog when refresh fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi
      .spyOn(serverUtils, "runChildProcess")
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "openrouter/example/stale-model\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockRejectedValueOnce(new Error("refresh unavailable"));

    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "openrouter/deepseek/deepseek-v4-flash-0731",
      }),
    ).rejects.toThrow("Available models: openrouter/example/stale-model");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.[2]).toEqual(["models", "--refresh"]);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'refresh failed for "openrouter/deepseek/deepseek-v4-flash-0731"',
      ),
    );
  });

  it("surfaces the last error once retries are exhausted", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(serverUtils, "runChildProcess").mockResolvedValue({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "queued behind another opencode run",
      pid: 1,
      startedAt: new Date().toISOString(),
    });

    const promise = discoverOpenCodeModels();
    const assertion = expect(promise).rejects.toThrow(
      "`opencode models` failed: queued behind another opencode run",
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
