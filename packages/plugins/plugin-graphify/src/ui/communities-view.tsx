import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import { useState, useMemo, useRef, useEffect } from "react";

export interface CommunityInfo {
  id: number;
  nodeCount: number;
  labels: string[];
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

export function communityColor(id: number): string {
  const hue = (id * 137.508) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

function communityColorMuted(id: number): string {
  const hue = (id * 137.508) % 360;
  return `hsl(${hue}, 35%, 75%)`;
}

interface Circle {
  x: number;
  y: number;
  r: number;
  community: CommunityInfo;
}

function packCircles(
  communities: CommunityInfo[],
  width: number,
  height: number,
): Circle[] {
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

export function BubbleChart({
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
        {hovered !== null &&
          (() => {
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

export function CommunityDetail({
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
