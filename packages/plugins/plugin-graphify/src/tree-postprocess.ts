const THEME_CSS = `
    body { background: transparent !important; color: #171717 !important;
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif !important; }
    h1 { color: #171717 !important; font-size: 1.25rem !important;
      font-weight: 600 !important; letter-spacing: -0.01em !important; }
    button { background: #fff !important; color: #525252 !important;
      border: 1px solid #e5e5e5 !important; box-shadow: none !important;
      font-size: 0.8rem !important; padding: 6px 14px !important;
      border-radius: 6px !important; }
    button:hover { background: #f5f5f5 !important; color: #171717 !important; }
    #tree-container { background: #fff !important; border-color: #e5e5e5 !important;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04) !important; }
    svg { background: #fff !important; }
    .link { stroke-opacity: 0.3 !important; stroke-width: 1.5px !important; }
    .node text { font: 11px ui-monospace, SFMono-Regular, monospace !important;
      stroke: #fff !important; }
    .node circle { stroke-width: 2px !important; }`;

const MUTED_PALETTE = `const PALETTE = [
      ["#5B8FA8","#476E82","#A3C4D4"], ["#6B9B7E","#527862","#A8CBB5"],
      ["#A8785B","#825C47","#D4B0A3"], ["#8B7BA8","#6B5F82","#BDB0D4"],
      ["#A89B5B","#827847","#D4CBA3"], ["#5BA8A0","#47827C","#A3D4CE"],
      ["#6B6B6B","#525252","#B8B8B8"], ["#A87D5B","#826047","#D4B8A3"],
      ["#5B8BA8","#476B82","#A3BDD4"], ["#A85B78","#82476B","#D4A3BD"],
      ["#78A85B","#5C8247","#B8D4A3"], ["#8B5BA8","#6B4782","#BDA3D4"],
      ["#5BA87D","#47826B","#A3D4B5"], ["#A8A85B","#828247","#D4D4A3"],
      ["#785BA8","#5C4782","#B8A3D4"],
    ];`;

const MUTED_LEVELS = `const levelSpecificPalettes = {
      0: { fill: "#171717", stroke: "#0a0a0a", collapsedFill: "#525252" },
      2: { fill: "#525252", stroke: "#404040", collapsedFill: "#a3a3a3" },
      3: { fill: "#6b6b6b", stroke: "#525252", collapsedFill: "#b8b8b8" },
      4: { fill: "#737373", stroke: "#5c5c5c", collapsedFill: "#c4c4c4" },
      5: { fill: "#525252", stroke: "#404040", collapsedFill: "#a3a3a3" },
      6: { fill: "#6b6b6b", stroke: "#525252", collapsedFill: "#b8b8b8" },
      default: { fill: "#737373", stroke: "#525252", collapsedFill: "#c4c4c4" },
    };`;

export function postProcessTreeHtml(html: string): string {
  let h = html;

  // --- Vertical layout (top-down instead of left-to-right) ---

  h = h.replace("d.y = d.depth * 400", "d.y = d.depth * 160");
  h = h.replace("d3.tree().nodeSize([40, 0])", "d3.tree().nodeSize([160, 0])");

  // Swap x/y in all node translate calls
  h = h.replaceAll(
    "translate(${source.y0},${source.x0})",
    "translate(${source.x0},${source.y0})",
  );
  h = h.replaceAll("translate(${d.y},${d.x})", "translate(${d.x},${d.y})");
  h = h.replaceAll(
    "translate(${source.y},${source.x})",
    "translate(${source.x},${source.y})",
  );

  // Vertical bezier diagonal
  h = h.replace(
    "function diagonal(s, d) { return `M ${s.y} ${s.x} C ${(s.y + d.y) / 2} ${s.x}, ${(s.y + d.y) / 2} ${d.x}, ${d.y} ${d.x}`; }",
    "function diagonal(s, d) { return `M ${s.x} ${s.y} C ${s.x} ${(s.y + d.y) / 2}, ${d.x} ${(s.y + d.y) / 2}, ${d.x} ${d.y}`; }",
  );

  // Margins: vertical needs less left, more top/bottom
  h = h.replace(
    "{ top: 40, right: 120, bottom: 80, left: 450 }",
    "{ top: 80, right: 40, bottom: 120, left: 40 }",
  );

  // Auto-resize: width from breadth, height from depth
  h = h.replace(
    "let neededHeight = Math.max(initialSvgHeight, maxX - minX + margin.top + margin.bottom + 100);",
    "let neededWidth = Math.max(initialSvgWidth, maxX - minX + margin.left + margin.right + 200);" +
    " let maxDepthY = d3.max(nodes, d => d.y) || 0;" +
    " let neededHeight = Math.max(initialSvgHeight, maxDepthY + margin.top + margin.bottom + 200);",
  );
  h = h.replace(
    'svgElement.transition().duration(duration / 2).attr("height", neededHeight);',
    'svgElement.transition().duration(duration / 2).attr("width", neededWidth).attr("height", neededHeight);',
  );
  h = h.replace(
    "translate(${margin.left},${margin.top - minX + 40})",
    "translate(${margin.left - minX + 40},${margin.top})",
  );

  // Text below nodes instead of beside
  h = h.replace(
    ".attr('x', d => d.children || d._children ? -14 : 14)",
    ".attr('x', 0)",
  );
  h = h.replace(
    ".attr('text-anchor', d => d.children || d._children ? 'end' : 'start')",
    ".attr('text-anchor', 'middle')",
  );
  h = h.replaceAll(".attr('dy', '.35em')", ".attr('dy', '1.8em')");
  h = h.replaceAll(".call(wrapText, 380)", ".call(wrapText, 150)");

  // --- Theming: ponytail-compatible neutral palette ---

  h = h.replace("</style>", THEME_CSS + "\n  </style>");
  h = h.replace(/const PALETTE = \[[\s\S]*?\];/, MUTED_PALETTE);
  h = h.replace(/const levelSpecificPalettes = \{(?:[^}]|\}(?!;))*\};/, MUTED_LEVELS);
  h = h.replace(
    '"Root": { fill: "#4A4A4A", stroke: "#333333", collapsedFill: "#6C757D" }',
    '"Root": { fill: "#171717", stroke: "#0a0a0a", collapsedFill: "#525252" }',
  );
  h = h.replace(
    '"Default": { fill: "#BDC3C7", stroke: "#95A5A6", collapsedFill: "#ECF0F1" }',
    '"Default": { fill: "#a3a3a3", stroke: "#737373", collapsedFill: "#d4d4d4" }',
  );
  h = h.replace("name: '#343a40'", "name: '#171717'");
  h = h.replace("count: '#0056b3'", "count: '#525252'");

  return h;
}
