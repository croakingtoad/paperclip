import { execFile } from "node:child_process";

const GRAPHIFY_BIN = process.env.GRAPHIFY_BIN ?? "graphify";
const EXEC_TIMEOUT_MS = 30_000;

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function run(args: string[], cwd?: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      GRAPHIFY_BIN,
      args,
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, cwd },
      (error, stdout, stderr) => {
        if (error && !("code" in error)) {
          reject(error);
          return;
        }
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: (error as NodeJS.ErrnoException & { code?: number })?.code
            ? 1
            : 0,
        });
      },
    );
  });
}

export async function graphifyQuery(
  graphPath: string,
  query: string,
  opts?: { dfs?: boolean; budget?: number },
): Promise<string> {
  const args = ["query", query];
  if (opts?.dfs) args.push("--dfs");
  if (opts?.budget) args.push("--budget", String(opts.budget));
  const result = await run(args, graphPath);
  if (result.exitCode !== 0) throw new Error(result.stderr || "graphify query failed");
  return result.stdout;
}

export async function graphifyPath(
  graphPath: string,
  source: string,
  target: string,
): Promise<string> {
  const result = await run(["path", source, target], graphPath);
  if (result.exitCode !== 0) throw new Error(result.stderr || "graphify path failed");
  return result.stdout;
}

export async function graphifyExplain(
  graphPath: string,
  node: string,
): Promise<string> {
  const result = await run(["explain", node], graphPath);
  if (result.exitCode !== 0) throw new Error(result.stderr || "graphify explain failed");
  return result.stdout;
}

export async function graphifyTree(graphDir: string): Promise<string> {
  const result = await run(["tree"], graphDir);
  if (result.exitCode !== 0) throw new Error(result.stderr || "graphify tree failed");
  return result.stdout;
}

export async function graphifyBuild(
  sourcePath: string,
  opts?: { update?: boolean; mode?: string },
): Promise<string> {
  const args = [sourcePath];
  if (opts?.update) args.push("--update");
  if (opts?.mode === "deep") args.push("--mode", "deep");
  args.push("--no-viz");
  const result = await run(args);
  if (result.exitCode !== 0) throw new Error(result.stderr || "graphify build failed");
  return result.stdout;
}
