import {
  usePluginData,
  useHostContext,
  usePluginToast,
} from "@paperclipai/plugin-sdk/ui";
import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";

// -- Types matching worker data handlers --

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

interface GraphNode {
  id: string;
  label: string;
  community: number;
  source_file?: string;
}

interface GraphLink {
  source: string;
  target: string;
  relation: string;
  weight: number;
}

interface CommunityData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface SearchResult {
  results: GraphNode[];
}

// -- Deterministic color from community ID --

function communityColor(id: number): string {
  const hue = (id * 137.508) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

function communityColorMuted(id: number): string {
  const hue = (id * 137.508) % 360;
  return `hsl(${hue}, 35%, 75%)`;
}

// -- Circle-packing layout (sorted largest-first, spiral placement) --

interface Circle {
  x: number;
  y: number;
  r: number;
  community: CommunityInfo;
}

function packCircles(communities: CommunityInfo[], width: number, height: number): Circle[] {
  if (communities.length === 0) return [];

  const maxNodes = communities[0]?.nodeCount ?? 1;
  const minR = 8;
  const maxR = Math.min(width, height) * 0.12;

  const circles: Circle[] = [];
  const cx = width / 2;
  const cy = height / 2;

  for (const comm of communities) {
    const r = minR + (maxR - minR) * Math.sqrt(comm.nodeCount / maxNodes);
    let placed = false;

    // Spiral outward to find non-overlapping position
    for (let a = 0; a < 2000 && !placed; a++) {
      const angle = a * 0.5;
      const dist = a * 1.2;
      const x = cx + dist * Math.cos(angle);
      const y = cy + dist * Math.sin(angle);

      const overlaps = circles.some((c) => {
        const dx = c.x - x;
        const dy = c.y - y;
        return Math.sqrt(dx * dx + dy * dy) < c.r + r + 2;
      });

      if (
        !overlaps &&
        x - r >= 0 &&
        x + r <= width &&
        y - r >= 0 &&
        y + r <= height
      ) {
        circles.push({ x, y, r, community: comm });
        placed = true;
      }
    }

    if (!placed) {
      // Fallback: place at center offset
      circles.push({
        x: cx + (Math.random() - 0.5) * width * 0.8,
        y: cy + (Math.random() - 0.5) * height * 0.8,
        r,
        community: comm,
      });
    }
  }

  return circles;
}

// -- Stat card --

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

// -- Community bubble chart (SVG) --

function BubbleChart({
  communities,
  onSelect,
  selectedId,
}: {
  communities: CommunityInfo[];
  onSelect: (id: number) => void;
  selectedId: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 500 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({
          width: Math.max(400, entry.contentRect.width),
          height: Math.max(300, entry.contentRect.height),
        });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const top100 = useMemo(() => communities.slice(0, 100), [communities]);
  const circles = useMemo(
    () => packCircles(top100, size.width, size.height),
    [top100, size.width, size.height],
  );

  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div
      ref={containerRef}
      className="h-[500px] w-full rounded-md border border-border bg-background"
    >
      <svg
        viewBox={`0 0 ${size.width} ${size.height}`}
        className="h-full w-full"
      >
        {circles.map((c) => {
          const isSelected = selectedId === c.community.id;
          const isHovered = hovered === c.community.id;
          return (
            <g
              key={c.community.id}
              onClick={() => onSelect(c.community.id)}
              onMouseEnter={() => setHovered(c.community.id)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              <circle
                cx={c.x}
                cy={c.y}
                r={c.r}
                fill={
                  isSelected
                    ? communityColor(c.community.id)
                    : communityColorMuted(c.community.id)
                }
                stroke={
                  isSelected || isHovered
                    ? communityColor(c.community.id)
                    : "transparent"
                }
                strokeWidth={isSelected ? 3 : isHovered ? 2 : 0}
                opacity={selectedId !== null && !isSelected ? 0.4 : 0.85}
              />
              {c.r > 18 && (
                <text
                  x={c.x}
                  y={c.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={Math.max(8, Math.min(c.r * 0.4, 14))}
                  fill="white"
                  className="pointer-events-none select-none"
                >
                  {c.community.nodeCount}
                </text>
              )}
            </g>
          );
        })}
        {hovered !== null && (() => {
          const c = circles.find((ci) => ci.community.id === hovered);
          if (!c) return null;
          const tipX = Math.min(c.x + c.r + 8, size.width - 180);
          const tipY = Math.max(c.y - 30, 10);
          return (
            <g className="pointer-events-none">
              <rect
                x={tipX}
                y={tipY}
                width={170}
                height={56}
                rx={4}
                fill="var(--background, #1a1a1a)"
                stroke="var(--border, #333)"
              />
              <text
                x={tipX + 8}
                y={tipY + 18}
                fontSize={12}
                fontWeight={600}
                fill="var(--foreground, #eee)"
              >
                Community {c.community.id}
              </text>
              <text
                x={tipX + 8}
                y={tipY + 34}
                fontSize={11}
                fill="var(--muted-foreground, #999)"
              >
                {c.community.nodeCount} nodes
              </text>
              <text
                x={tipX + 8}
                y={tipY + 48}
                fontSize={10}
                fill="var(--muted-foreground, #999)"
              >
                {c.community.labels.slice(0, 3).join(", ")}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// -- Community detail panel --

function CommunityDetail({
  communityId,
  companyId,
  projectId,
  onClose,
}: {
  communityId: number;
  companyId: string;
  projectId?: string | null;
  onClose: () => void;
}) {
  const { data, loading, error } = usePluginData<CommunityData>(
    "graph-community",
    { companyId, communityId, projectId: projectId ?? undefined },
  );

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="text-sm font-medium text-foreground">
          Community {communityId}
          {data && (
            <span className="ml-2 text-xs text-muted-foreground">
              {data.nodes.length} nodes · {data.links.length} edges
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ✕ Close
        </button>
      </div>
      <div className="max-h-[400px] overflow-auto px-4 py-2">
        {loading && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            Loading community…
          </div>
        )}
        {error && (
          <div className="py-4 text-center text-sm text-destructive">
            {error.message}
          </div>
        )}
        {data && (
          <div className="space-y-1">
            {data.nodes.map((node) => (
              <div
                key={node.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/40"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: communityColor(node.community) }}
                />
                <span className="font-mono text-xs text-foreground">
                  {node.label}
                </span>
                {node.source_file && (
                  <span className="ml-auto truncate text-[11px] text-muted-foreground">
                    {node.source_file}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// -- Search panel --

function SearchPanel({ companyId, projectId }: { companyId: string; projectId?: string | null }) {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const { data, loading } = usePluginData<SearchResult>(
    "graph-search",
    searchTerm ? { companyId, projectId: projectId ?? undefined, query: searchTerm, limit: 50 } : undefined,
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
          No nodes found for "{searchTerm}"
        </div>
      )}
    </div>
  );
}

// -- Unconfigured state --

function UnconfiguredState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <div className="text-sm font-medium text-foreground">
        Graphify data folder not configured
      </div>
      <div className="max-w-md text-center text-xs text-muted-foreground">
        Set the <code className="rounded bg-muted px-1 py-0.5">graphify-data</code>{" "}
        local folder in plugin settings to your <code>graphify-out</code> directory.
        Run <code>graphify .</code> in your project first to generate the graph.
      </div>
    </div>
  );
}

// -- Main graph page --

export function GraphPage() {
  const { companyId } = useHostContext();
  const [selectedCommunity, setSelectedCommunity] = useState<number | null>(null);

  const { data, loading, error, refresh } = usePluginData<GraphOverview>(
    "graph-overview",
    companyId ? { companyId } : undefined,
  );

  if (!companyId) {
    return <UnconfiguredState />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-sm text-muted-foreground">Loading graph data…</div>
      </div>
    );
  }

  if (error) {
    const isNotConfigured =
      error.message?.includes("not configured") ||
      error.message?.includes("unhealthy");
    if (isNotConfigured) return <UnconfiguredState />;
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
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">
          Knowledge Graph
        </h1>
        <button
          type="button"
          onClick={() => refresh()}
          className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Nodes" value={data.nodeCount} />
        <Stat label="Edges" value={data.linkCount} />
        <Stat label="Communities" value={data.communityCount} />
        <Stat
          label="Built at"
          value={data.builtAtCommit?.slice(0, 12) ?? "—"}
        />
      </div>

      {/* Search */}
      <SearchPanel companyId={companyId} />

      {/* Bubble chart */}
      <div>
        <div className="mb-2 text-xs text-muted-foreground">
          Top 100 communities by size — click to inspect
        </div>
        <BubbleChart
          communities={data.communities}
          onSelect={setSelectedCommunity}
          selectedId={selectedCommunity}
        />
      </div>

      {/* Community detail */}
      {selectedCommunity !== null && (
        <CommunityDetail
          communityId={selectedCommunity}
          companyId={companyId}
          onClose={() => setSelectedCommunity(null)}
        />
      )}
    </div>
  );
}

// -- Fullscreen wrapper --

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
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-sm font-medium text-foreground">Graphify — Knowledge Graph</span>
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

// -- Project detail tab --

export function GraphifyProjectTab() {
  const { companyId, projectId } = useHostContext();
  const [selectedCommunity, setSelectedCommunity] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { data, loading, error, refresh } = usePluginData<GraphOverview>(
    "graph-overview",
    companyId ? { companyId, projectId: projectId ?? undefined } : undefined,
  );

  const toggleFullscreen = useCallback(() => setIsFullscreen((v) => !v), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) setIsFullscreen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isFullscreen]);

  if (!companyId) {
    return <UnconfiguredState />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-sm text-muted-foreground">Loading graph data…</div>
      </div>
    );
  }

  if (error) {
    const isNotConfigured =
      error.message?.includes("not configured") ||
      error.message?.includes("not found") ||
      error.message?.includes("unhealthy");
    if (isNotConfigured) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <div className="text-sm font-medium text-foreground">
            Graphify data not available
          </div>
          <div className="max-w-md text-center text-xs text-muted-foreground">
            Set the <code className="rounded bg-muted px-1 py-0.5">GRAPHIFY_GRAPH_PATH</code>{" "}
            env variable on this project to point to your <code>graph.json</code> file,
            or configure the <code className="rounded bg-muted px-1 py-0.5">graphify-data</code>{" "}
            local folder in plugin settings.
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3 px-4 py-8">
        <div className="text-sm text-destructive">{error.message}</div>
        <button type="button" onClick={() => refresh()} className="text-xs text-muted-foreground hover:text-foreground">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const content = (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Knowledge Graph</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => refresh()}
            className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {isFullscreen ? "Exit fullscreen" : "Expand"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Nodes" value={data.nodeCount} />
        <Stat label="Edges" value={data.linkCount} />
        <Stat label="Communities" value={data.communityCount} />
        <Stat label="Built at" value={data.builtAtCommit?.slice(0, 12) ?? "—"} />
      </div>

      <SearchPanel companyId={companyId} projectId={projectId} />

      <div>
        <div className="mb-2 text-xs text-muted-foreground">
          Top 100 communities by size — click to inspect
        </div>
        <BubbleChart
          communities={data.communities}
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
    </div>
  );

  return (
    <FullscreenWrapper isFullscreen={isFullscreen} onToggle={toggleFullscreen}>
      {content}
    </FullscreenWrapper>
  );
}

// -- Sidebar link --

export function SidebarLink() {
  return null;
}
