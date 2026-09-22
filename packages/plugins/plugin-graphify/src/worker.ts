import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, ToolRunContext, ToolResult } from "@paperclipai/plugin-sdk";
import { readFile, stat, readdir } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join, dirname } from "node:path";
import { GRAPHIFY_FOLDER_KEY, GRAPHIFY_SKILL_KEY } from "./manifest.js";
import {
  graphifyQuery,
  graphifyPath,
  graphifyExplain,
  graphifyBuild,
} from "./graphify-cli.js";

interface GraphNode {
  id: string;
  label: string;
  community: number;
  file_type?: string;
  source_file?: string;
  norm_label?: string;
}

interface GraphLink {
  source: string;
  target: string;
  relation: string;
  weight: number;
  confidence_score?: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  built_at_commit?: string;
}

interface CommunityInfo {
  id: number;
  nodeCount: number;
  labels: string[];
}

interface GraphOverview {
  nodeCount: number;
  linkCount: number;
  communityCount: number;
  builtAtCommit: string | null;
  communities: CommunityInfo[];
}

function readString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function resolveGraphPath(ctx: PluginContext, companyId: string): Promise<string> {
  const status = await ctx.localFolders.status(companyId, GRAPHIFY_FOLDER_KEY);
  if (!status.healthy || !status.path) {
    throw new Error(
      "Graphify data folder is not configured or unhealthy. " +
      "Set the local folder path in plugin settings to your graphify-out directory.",
    );
  }
  return status.path;
}

function extractPlainEnvValue(binding: unknown): string | null {
  if (typeof binding === "string") return binding;
  if (binding && typeof binding === "object" && "type" in binding && (binding as { type: string }).type === "plain") {
    return (binding as { value: string }).value ?? null;
  }
  return null;
}

async function resolveGraphDir(envPath: string): Promise<string> {
  const s = await stat(envPath);
  if (s.isDirectory()) return envPath;
  if (s.isFile() && envPath.endsWith(".json")) return dirname(envPath);
  throw new Error(`GRAPHIFY_GRAPH_PATH is not a valid path: ${envPath}`);
}

async function resolveGraphPathForProject(
  ctx: PluginContext,
  companyId: string,
  projectId: string | null,
): Promise<string> {
  // Try local folder first
  try {
    return await resolveGraphPath(ctx, companyId);
  } catch {
    // fall through
  }

  // Try project env var
  if (projectId) {
    const project = await ctx.projects.get(projectId, companyId);
    const envVal = project?.env?.GRAPHIFY_GRAPH_PATH;
    if (envVal) {
      const path = extractPlainEnvValue(envVal);
      if (path) return resolveGraphDir(path);
    }
  }

  throw new Error(
    "Graphify data not found. Either configure the graphify-data local folder " +
    "in plugin settings, or set GRAPHIFY_GRAPH_PATH in the project env.",
  );
}

interface GraphCacheEntry {
  data: GraphData;
  mtimeMs: number;
  watcher: FSWatcher | null;
}

const graphCache = new Map<string, GraphCacheEntry>();

async function loadGraphCached(graphDir: string): Promise<GraphData> {
  const filePath = join(graphDir, "graph.json");
  const s = await stat(filePath);
  const entry = graphCache.get(filePath);

  if (entry && entry.mtimeMs === s.mtimeMs) return entry.data;

  entry?.watcher?.close();

  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw) as GraphData;

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(filePath, () => {
      const cached = graphCache.get(filePath);
      if (cached) {
        cached.watcher?.close();
        graphCache.delete(filePath);
      }
    });
    watcher.unref();
  } catch {
    // ponytail: fs.watch fails on some FS types; stat-based mtime check is the fallback
  }

  graphCache.set(filePath, { data, mtimeMs: s.mtimeMs, watcher });
  return data;
}

function buildOverview(graph: GraphData): GraphOverview {
  const communityMap = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const labels = communityMap.get(node.community);
    if (labels) {
      if (labels.length < 5) labels.push(node.label);
    } else {
      communityMap.set(node.community, [node.label]);
    }
  }

  const communities: CommunityInfo[] = [];
  const countMap = new Map<number, number>();
  for (const node of graph.nodes) {
    countMap.set(node.community, (countMap.get(node.community) ?? 0) + 1);
  }
  for (const [id, labels] of communityMap) {
    communities.push({ id, nodeCount: countMap.get(id) ?? 0, labels });
  }
  communities.sort((a, b) => b.nodeCount - a.nodeCount);

  return {
    nodeCount: graph.nodes.length,
    linkCount: graph.links.length,
    communityCount: communities.length,
    builtAtCommit: graph.built_at_commit ?? null,
    communities,
  };
}

function searchNodes(graph: GraphData, query: string, limit: number) {
  const q = query.toLowerCase();
  const matches: GraphNode[] = [];
  for (const node of graph.nodes) {
    if (matches.length >= limit) break;
    if (
      node.label.toLowerCase().includes(q) ||
      node.id.toLowerCase().includes(q) ||
      (node.source_file?.toLowerCase().includes(q))
    ) {
      matches.push(node);
    }
  }
  return matches;
}

function communityNodes(graph: GraphData, communityId: number) {
  const nodes = graph.nodes.filter((n) => n.community === communityId);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const links = graph.links.filter(
    (l) => nodeIds.has(l.source) && nodeIds.has(l.target),
  );
  return { nodes, links };
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    ctx.logger.info("graphify plugin setup");

    // -- Data handlers for UI --

    ctx.data.register("graph-overview", async (params) => {
      const companyId = readString(params.companyId);
      const projectId = readString(params.projectId) || null;
      if (!companyId) throw new Error("companyId required");
      const graphDir = await resolveGraphPathForProject(ctx, companyId, projectId);
      const graph = await loadGraphCached(graphDir);
      return buildOverview(graph);
    });

    ctx.data.register("graph-community", async (params) => {
      const companyId = readString(params.companyId);
      const projectId = readString(params.projectId) || null;
      const communityId = Number(params.communityId);
      if (!companyId) throw new Error("companyId required");
      if (!Number.isFinite(communityId)) throw new Error("communityId required");
      const graphDir = await resolveGraphPathForProject(ctx, companyId, projectId);
      const graph = await loadGraphCached(graphDir);
      return communityNodes(graph, communityId);
    });

    ctx.data.register("graph-search", async (params) => {
      const companyId = readString(params.companyId);
      const projectId = readString(params.projectId) || null;
      const query = readString(params.query);
      const limit = Math.min(Number(params.limit) || 50, 200);
      if (!companyId || !query) throw new Error("companyId and query required");
      const graphDir = await resolveGraphPathForProject(ctx, companyId, projectId);
      const graph = await loadGraphCached(graphDir);
      return { results: searchNodes(graph, query, limit) };
    });

    const KNOWN_HTML_NAMES: Record<string, string> = {
      "graph.html": "Force Graph",
      "GRAPH_TREE.html": "Tree View",
    };

    ctx.data.register("graph-available-views", async (params) => {
      const companyId = readString(params.companyId);
      const projectId = readString(params.projectId) || null;
      if (!companyId) throw new Error("companyId required");
      const graphDir = await resolveGraphPathForProject(ctx, companyId, projectId);
      const entries = await readdir(graphDir);
      const htmlFiles = new Set(entries.filter((e) => e.endsWith(".html")));
      const views: Array<{ id: string; name: string; file?: string; generated: boolean }> = [
        { id: "communities", name: "Communities", generated: true },
      ];
      for (const file of Object.keys(KNOWN_HTML_NAMES)) {
        if (!htmlFiles.has(file)) continue;
        views.push({
          id: file,
          name: KNOWN_HTML_NAMES[file],
          file,
          generated: true,
        });
        htmlFiles.delete(file);
      }
      for (const file of [...htmlFiles].sort()) {
        views.push({
          id: file,
          name: file.replace(/\.html$/, "").replace(/[_-]/g, " "),
          file,
          generated: true,
        });
      }
      return { views };
    });

    ctx.data.register("graph-html-view", async (params) => {
      const companyId = readString(params.companyId);
      const projectId = readString(params.projectId) || null;
      const viewFile = readString(params.viewFile);
      if (!companyId || !viewFile) throw new Error("companyId and viewFile required");
      if (!viewFile.endsWith(".html") || /[/\\]|\.\./.test(viewFile)) {
        throw new Error("invalid view file");
      }
      const graphDir = await resolveGraphPathForProject(ctx, companyId, projectId);
      const filePath = join(graphDir, viewFile);
      await stat(filePath);
      return { html: await readFile(filePath, "utf8") };
    });

    // -- Managed skill reconciliation --

    ctx.actions.register("reconcile-managed-skills", async (params) => {
      const companyId = readString((params as Record<string, unknown>).companyId);
      if (!companyId) throw new Error("companyId required");
      const resolved = await ctx.skills.managed.reconcile(GRAPHIFY_SKILL_KEY, companyId);
      return { managedSkills: [resolved] };
    });

    // -- Agent tool handlers --

    ctx.tools.register(
      "graphify_query",
      {
        displayName: "Query Graph",
        description: "Natural-language query against the Graphify knowledge graph.",
        parametersSchema: {
          type: "object",
          properties: {
            companyId: { type: "string" },
            query: { type: "string" },
            dfs: { type: "boolean" },
            budget: { type: "number" },
          },
          required: ["companyId", "query"],
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as Record<string, unknown>;
        const companyId = readString(p.companyId);
        const query = readString(p.query);
        if (!companyId || !query) return { error: "companyId and query required" };
        try {
          const graphDir = await resolveGraphPath(ctx, companyId);
          const output = await graphifyQuery(graphDir, query, {
            dfs: Boolean(p.dfs),
            budget: typeof p.budget === "number" ? p.budget : undefined,
          });
          return { content: output };
        } catch (err) {
          return { error: String(err) };
        }
      },
    );

    ctx.tools.register(
      "graphify_path",
      {
        displayName: "Find Path",
        description: "Find the exact path between two nodes in the knowledge graph.",
        parametersSchema: {
          type: "object",
          properties: {
            companyId: { type: "string" },
            source: { type: "string" },
            target: { type: "string" },
          },
          required: ["companyId", "source", "target"],
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as Record<string, unknown>;
        const companyId = readString(p.companyId);
        const source = readString(p.source);
        const target = readString(p.target);
        if (!companyId || !source || !target) return { error: "companyId, source, and target required" };
        try {
          const graphDir = await resolveGraphPath(ctx, companyId);
          const output = await graphifyPath(graphDir, source, target);
          return { content: output };
        } catch (err) {
          return { error: String(err) };
        }
      },
    );

    ctx.tools.register(
      "graphify_explain",
      {
        displayName: "Explain Node",
        description: "Return everything the graph knows about a specific node.",
        parametersSchema: {
          type: "object",
          properties: {
            companyId: { type: "string" },
            node: { type: "string" },
          },
          required: ["companyId", "node"],
        },
      },
      async (params: unknown, _runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as Record<string, unknown>;
        const companyId = readString(p.companyId);
        const node = readString(p.node);
        if (!companyId || !node) return { error: "companyId and node required" };
        try {
          const graphDir = await resolveGraphPath(ctx, companyId);
          const output = await graphifyExplain(graphDir, node);
          return { content: output };
        } catch (err) {
          return { error: String(err) };
        }
      },
    );

    ctx.tools.register(
      "graphify_build",
      {
        displayName: "Build/Update Graph",
        description: "Run graphify on the project workspace to build or update the graph.",
        parametersSchema: {
          type: "object",
          properties: {
            companyId: { type: "string" },
            path: { type: "string" },
            update: { type: "boolean" },
            mode: { type: "string" },
          },
          required: ["companyId"],
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as Record<string, unknown>;
        const companyId = readString(p.companyId);
        if (!companyId) return { error: "companyId required" };
        try {
          const workspace = await ctx.projects.getPrimaryWorkspace(
            runCtx.projectId,
            companyId,
          );
          const sourcePath = readString(p.path) || workspace?.path || ".";
          const output = await graphifyBuild(sourcePath, {
            update: Boolean(p.update),
            mode: readString(p.mode) || undefined,
          });
          return { content: output };
        } catch (err) {
          return { error: String(err) };
        }
      },
    );
  },

  async onHealth() {
    return { status: "ok", message: "graphify plugin ready" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
