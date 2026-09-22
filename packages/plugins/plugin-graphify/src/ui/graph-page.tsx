import {
  usePluginData,
  useHostContext,
} from "@paperclipai/plugin-sdk/ui";
import {
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  BubbleChart,
  CommunityDetail,
  communityColor,
  type CommunityInfo,
} from "./communities-view.js";

interface GraphOverview {
  nodeCount: number;
  linkCount: number;
  communityCount: number;
  builtAtCommit: string | null;
  communities: CommunityInfo[];
}

interface GraphNode {
  id: string;
  label: string;
  community: number;
  source_file?: string;
}

interface SearchResult {
  results: GraphNode[];
}

interface ViewInfo {
  id: string;
  name: string;
  file?: string;
  generated?: boolean;
}

// -- Small shared components --

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-background px-4 py-3">
      <div className="text-2xl font-semibold text-foreground">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function SearchPanel({
  companyId,
  projectId,
}: {
  companyId: string;
  projectId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const { data, loading } = usePluginData<SearchResult>(
    "graph-search",
    searchTerm
      ? {
          companyId,
          projectId: projectId ?? undefined,
          query: searchTerm,
          limit: 50,
        }
      : undefined,
  );
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setSearchTerm(query.trim());
    },
    [query],
  );

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="h-8 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/40"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes…"
        />
        <button
          type="submit"
          className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Search
        </button>
      </form>
      {loading && (
        <div className="py-2 text-center text-xs text-muted-foreground">
          Searching…
        </div>
      )}
      {data && data.results.length > 0 && (
        <div className="max-h-[300px] overflow-auto rounded-md border border-border bg-background">
          {data.results.map((node) => (
            <div
              key={node.id}
              className="flex items-center gap-2 border-b border-border/50 px-3 py-2 last:border-b-0"
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: communityColor(node.community) }}
              />
              <span className="font-mono text-xs text-foreground">
                {node.label}
              </span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                C{node.community}
              </span>
            </div>
          ))}
        </div>
      )}
      {data && data.results.length === 0 && searchTerm && (
        <div className="py-2 text-center text-xs text-muted-foreground">
          No nodes found for &ldquo;{searchTerm}&rdquo;
        </div>
      )}
    </div>
  );
}

// -- View toggle --

function ViewTabs({
  views,
  activeView,
  onSelect,
}: {
  views: ViewInfo[];
  activeView: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onSelect(v.id)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeView === v.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {v.name}
        </button>
      ))}
    </div>
  );
}

// -- HTML iframe view (for graph.html, GRAPH_TREE.html, etc.) --

function HtmlIframeView({
  companyId,
  projectId,
  viewFile,
}: {
  companyId: string;
  projectId?: string | null;
  viewFile: string;
}) {
  const { data, loading, error } = usePluginData<{ html: string }>(
    "graph-html-view",
    { companyId, projectId: projectId ?? undefined, viewFile },
  );
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.html) {
      setBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([data.html], { type: "text/html" }),
    );
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [data?.html]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-sm text-muted-foreground">
          Loading visualization…
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-8 text-center text-sm text-destructive">
        {error.message}
      </div>
    );
  }
  if (!blobUrl) return null;

  return (
    <iframe
      src={blobUrl}
      className="w-full rounded-md border border-border bg-white"
      style={{ height: "calc(100vh - 16rem)", minHeight: "500px" }}
      sandbox="allow-scripts"
      title={viewFile}
    />
  );
}

// -- States --

function UnconfiguredState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <div className="text-sm font-medium text-foreground">
        Graphify data not available
      </div>
      <div className="max-w-lg space-y-3 text-center text-xs text-muted-foreground">
        <p>Configure a path to a directory containing <code className="rounded bg-muted px-1 py-0.5">graph.json</code>:</p>
        <div className="mx-auto max-w-md space-y-2 text-left">
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="font-medium text-foreground">Per-project</div>
            Set <code className="rounded bg-muted px-1 py-0.5">GRAPHIFY_GRAPH_PATH</code> in this project&apos;s environment variables (Configuration tab). Only affects this project.
          </div>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="font-medium text-foreground">Company-wide default</div>
            Set the <code className="rounded bg-muted px-1 py-0.5">Graphify output</code> local folder on the plugin settings page. Applies to all projects that don&apos;t have their own <code className="rounded bg-muted px-1 py-0.5">GRAPHIFY_GRAPH_PATH</code>.
          </div>
        </div>
      </div>
    </div>
  );
}

function FullscreenWrapper({
  isFullscreen,
  onToggle,
  children,
}: {
  isFullscreen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  if (!isFullscreen) return <>{children}</>;
  return (
    <div
      className="fixed inset-0 z-50 overflow-auto bg-background"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
      }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-sm font-medium text-foreground">
            Graphify — Knowledge Graph
          </span>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Exit fullscreen
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

// -- Main content (shared between standalone page and project tab) --

function GraphViewContent({
  companyId,
  projectId,
  overview,
  refresh,
  extraButtons,
}: {
  companyId: string;
  projectId?: string | null;
  overview: GraphOverview;
  refresh: () => void;
  extraButtons?: ReactNode;
}) {
  const [activeView, setActiveView] = useState("communities");
  const [selectedCommunity, setSelectedCommunity] = useState<number | null>(
    null,
  );

  const { data: viewsData } = usePluginData<{ views: ViewInfo[] }>(
    "graph-available-views",
    { companyId, projectId: projectId ?? undefined },
  );
  const views = viewsData?.views ?? [{ id: "communities", name: "Communities" }];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">
          Knowledge Graph
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={refresh}
            className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Refresh
          </button>
          {extraButtons}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Nodes" value={overview.nodeCount} />
        <Stat label="Edges" value={overview.linkCount} />
        <Stat label="Communities" value={overview.communityCount} />
        <Stat
          label="Built at"
          value={overview.builtAtCommit?.slice(0, 12) ?? "—"}
        />
      </div>

      {views.length > 1 && (
        <ViewTabs
          views={views}
          activeView={activeView}
          onSelect={setActiveView}
        />
      )}

      {activeView === "communities" ? (
        <>
          <SearchPanel companyId={companyId} projectId={projectId} />
          <div>
            <div className="mb-2 text-xs text-muted-foreground">
              Top 100 communities by size — click to inspect
            </div>
            <BubbleChart
              communities={overview.communities}
              onSelect={setSelectedCommunity}
              selectedId={selectedCommunity}
            />
          </div>
          {selectedCommunity !== null && (
            <CommunityDetail
              communityId={selectedCommunity}
              companyId={companyId}
              projectId={projectId}
              onClose={() => setSelectedCommunity(null)}
            />
          )}
        </>
      ) : (() => {
        const view = views.find((v) => v.id === activeView);
        return view?.file ? (
          <HtmlIframeView
            companyId={companyId}
            projectId={projectId}
            viewFile={view.file}
          />
        ) : null;
      })()}
    </div>
  );
}

// -- Exports --

export function GraphPage() {
  const { companyId } = useHostContext();
  const { data, loading, error, refresh } = usePluginData<GraphOverview>(
    "graph-overview",
    companyId ? { companyId } : undefined,
  );

  if (!companyId) return <UnconfiguredState />;
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-sm text-muted-foreground">
          Loading graph data…
        </div>
      </div>
    );
  }
  if (error) {
    if (
      error.message?.includes("not configured") ||
      error.message?.includes("unhealthy")
    ) {
      return <UnconfiguredState />;
    }
    return (
      <div className="space-y-3 px-4 py-8">
        <div className="text-sm text-destructive">{error.message}</div>
        <button
          type="button"
          onClick={() => refresh()}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="p-4">
      <GraphViewContent
        companyId={companyId}
        overview={data}
        refresh={refresh}
      />
    </div>
  );
}

export function GraphifyProjectTab() {
  const { companyId, projectId } = useHostContext();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = useCallback(
    () => setIsFullscreen((v) => !v),
    [],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) setIsFullscreen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isFullscreen]);

  const { data, loading, error, refresh } = usePluginData<GraphOverview>(
    "graph-overview",
    companyId
      ? { companyId, projectId: projectId ?? undefined }
      : undefined,
  );

  if (!companyId) return <UnconfiguredState />;
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-sm text-muted-foreground">
          Loading graph data…
        </div>
      </div>
    );
  }
  if (error) {
    if (
      error.message?.includes("not configured") ||
      error.message?.includes("not found") ||
      error.message?.includes("unhealthy")
    ) {
      return <UnconfiguredState />;
    }
    return (
      <div className="space-y-3 px-4 py-8">
        <div className="text-sm text-destructive">{error.message}</div>
        <button
          type="button"
          onClick={() => refresh()}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!data) return null;

  const expandBtn = (
    <button
      type="button"
      onClick={toggleFullscreen}
      className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground"
    >
      {isFullscreen ? "Exit fullscreen" : "Expand"}
    </button>
  );

  return (
    <FullscreenWrapper isFullscreen={isFullscreen} onToggle={toggleFullscreen}>
      <GraphViewContent
        companyId={companyId}
        projectId={projectId}
        overview={data}
        refresh={refresh}
        extraButtons={expandBtn}
      />
    </FullscreenWrapper>
  );
}

export function SidebarLink() {
  return null;
}
