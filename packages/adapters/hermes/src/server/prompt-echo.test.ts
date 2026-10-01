import { expect, test } from "vitest";

import { createPromptEchoFilter } from "./execute.js";

// A real Paperclip-shaped prompt and the echo Hermes actually produced for it:
// captured by running the exact `console.print(f"[bold blue]Query:[/] {query}")`
// from hermes_cli/cli_single_query.py through Rich at its non-TTY width. Note
// what Rich did to it — re-wrapped at 80 columns (splitting the JSON line
// mid-token), ate `[[their-name]]` as markup, left `[Title](doc/file.md)`
// alone — which is why the filter compares with brackets and whitespace gone.
const PROMPT = "You are an agent at Paperclip company.\n\n## Execution Contract\n\n- Start actionable work in the same heartbeat. Do not stop at a plan unless the issue explicitly asks for planning.\n- Include `-H \"Authorization: Bearer $PAPERCLIP_API_KEY\"` on API requests.\n- Include `-H \"X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID\"` on mutating issue requests.\n- Link related memories with [[their-name]] so the index stays navigable.\n- See [Title](doc/file.md) for the long form of this contract.\n\nPaperclip task context:\n- Issue: \"LOC-58\"\n- Title: \"Help me fix Hermes agent\"\n\n```json\n{\"reason\":\"issue_assigned\",\"categories\":[\"adapter\",\"secrets\",\"runtimeSkills\"],\"freshness\":{\"reset\":false}}\n```\n\nFinal disposition checklist: mark `done` when complete and verified; use `in_review` only with a real reviewer, approval, interaction, or monitor path.";

const ECHO = "Query: You are an agent at Paperclip company.\n\n## Execution Contract\n\n- Start actionable work in the same heartbeat. Do not stop at a plan unless the \nissue explicitly asks for planning.\n- Include `-H \"Authorization: Bearer $PAPERCLIP_API_KEY\"` on API requests.\n- Include `-H \"X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID\"` on mutating issue \nrequests.\n- Link related memories with [] so the index stays navigable.\n- See [Title](doc/file.md) for the long form of this contract.\n\nPaperclip task context:\n- Issue: \"LOC-58\"\n- Title: \"Help me fix Hermes agent\"\n\n```json\n{\"reason\":\"issue_assigned\",\"categories\":[\"adapter\",\"secrets\",\"runtimeSkills\"],\"f\nreshness\":{\"reset\":false}}\n```\n\nFinal disposition checklist: mark `done` when complete and verified; use \n`in_review` only with a real reviewer, approval, interaction, or monitor path.\n";

test("drops the query echo Hermes writes before the agent starts", () => {
  const strip = createPromptEchoFilter(PROMPT);
  expect(strip(ECHO)).toBe("");
});

test("drops an echo split across stdout chunks", () => {
  const strip = createPromptEchoFilter(PROMPT);
  const split = Math.floor(ECHO.length / 2);
  expect(strip(ECHO.slice(0, split))).toBe("");
  expect(strip(ECHO.slice(split))).toBe("");
});

test("passes agent output through untouched", () => {
  const strip = createPromptEchoFilter(PROMPT);
  const toolLine = "  \u250a \ud83d\udcbb $         curl -s http://127.0.0.1:3101/api  0.1s\r\n";
  expect(strip(ECHO)).toBe("");
  expect(strip(toolLine)).toBe(toolLine);
  expect(strip("Fixed the launcher path.\r\n")).toBe("Fixed the launcher path.\r\n");
});

test("keeps stdout that only looks like the start of the prompt", () => {
  const strip = createPromptEchoFilter(PROMPT);
  const quoted = `Query: ${PROMPT.slice(0, 120)} ... and then I stopped quoting.`;
  expect(strip(quoted)).toBe(quoted);
});

test("leaves short prompts alone", () => {
  const strip = createPromptEchoFilter("Say only the single word: verified");
  expect(strip("Query: Say only the single word: verified\n")).toBe(
    "Query: Say only the single word: verified\n",
  );
});
