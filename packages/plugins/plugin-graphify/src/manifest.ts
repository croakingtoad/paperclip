import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { readFileSync } from "node:fs";

export const PLUGIN_ID = "paperclipai.plugin-graphify";
export const GRAPHIFY_FOLDER_KEY = "graphify-data";
export const GRAPHIFY_SKILL_KEY = "graphify";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version,
  displayName: "Graphify",
  description:
    "Knowledge graph plugin — wraps Graphify CLI for agents and displays an interactive graph visualization per project.",
  author: "Paperclip",
  categories: ["automation", "ui"],
  capabilities: [
    "local.folders",
    "agent.tools.register",
    "plugin.state.read",
    "plugin.state.write",
    "projects.read",
    "project.workspaces.read",
    "ui.sidebar.register",
    "ui.page.register",
    "ui.detailTab.register",
    "skills.managed",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  localFolders: [
    {
      folderKey: GRAPHIFY_FOLDER_KEY,
      displayName: "Graphify output (company-wide default)",
      description:
        "Company-wide default path to a graphify-out/ directory (must contain graph.json). Applies to all projects unless a project overrides it with the GRAPHIFY_GRAPH_PATH environment variable in its own configuration.",
      access: "read",
      requiredFiles: ["graph.json"],
    },
  ],
  tools: [
    {
      name: "graphify_query",
      displayName: "Query Graph",
      description:
        "Natural-language query against the Graphify knowledge graph. Returns relevant nodes, edges, and structural context. Use --dfs for depth-first path tracing, --budget to cap tokens.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          query: { type: "string", description: "Natural language query" },
          dfs: {
            type: "boolean",
            description: "Use depth-first search tracing",
          },
          budget: {
            type: "number",
            description: "Max tokens to return",
          },
        },
        required: ["companyId", "query"],
      },
    },
    {
      name: "graphify_path",
      displayName: "Find Path",
      description:
        "Find the exact path between two nodes in the knowledge graph.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          source: { type: "string", description: "Source node label or ID" },
          target: { type: "string", description: "Target node label or ID" },
        },
        required: ["companyId", "source", "target"],
      },
    },
    {
      name: "graphify_explain",
      displayName: "Explain Node",
      description:
        "Return everything the graph knows about a specific node — its edges, community, and context.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          node: { type: "string", description: "Node label or ID to explain" },
        },
        required: ["companyId", "node"],
      },
    },
    {
      name: "graphify_build",
      displayName: "Build/Update Graph",
      description:
        "Run graphify on the project workspace to build or update the knowledge graph. Use --update for incremental rebuild.",
      parametersSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          path: {
            type: "string",
            description: "Path to source directory (defaults to workspace root)",
          },
          update: {
            type: "boolean",
            description: "Incremental update instead of full rebuild",
          },
          mode: {
            type: "string",
            enum: ["default", "deep"],
            description: "Extraction mode — deep enables aggressive inferred edges",
          },
        },
        required: ["companyId"],
      },
    },
  ],
  skills: [
    {
      skillKey: GRAPHIFY_SKILL_KEY,
      displayName: "Graphify",
      slug: "graphify",
      description:
        "Prefer Graphify knowledge graph tools over expensive grep/find for structural codebase questions.",
      markdown: readFileSync(
        new URL("../skills/graphify/SKILL.md", import.meta.url),
        "utf8",
      ),
    },
  ],
  ui: {
    slots: [
      {
        type: "sidebar",
        id: "graphify-sidebar",
        displayName: "Graph",
        exportName: "SidebarLink",
        order: 40,
      },
      {
        type: "page",
        id: "graphify-page",
        displayName: "Knowledge Graph",
        exportName: "GraphPage",
        routePath: "graphify",
      },
      {
        type: "detailTab",
        id: "graphify-project-tab",
        displayName: "Graphify",
        exportName: "GraphifyProjectTab",
        entityTypes: ["project"],
        order: 50,
      },
    ],
  },
};

export default manifest;
