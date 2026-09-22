# Graphify Knowledge Graph

A pre-built knowledge graph of the codebase is available through the Graphify plugin tools. Before expensive codebase searches (grep across many files, recursive find, broad Explore agents), check whether Graphify can answer the question faster.

## When to use

- **Structural questions**: "What depends on X?", "How does A relate to B?", "What files are in this module?"
- **Navigation**: finding paths between components, tracing call chains, understanding module boundaries
- **Exploration**: discovering what exists in an area of the codebase before diving into files

## When NOT to use

- Literal string searches or regex matches — use grep
- Recent uncommitted changes — the graph reflects the last build
- Reading actual file contents — use Read/cat

## Tools

| Tool | Purpose | Example |
|------|---------|---------|
| `graphify_query` | Natural language question about the codebase | `graphify_query("What modules handle authentication?")` |
| `graphify_path` | Find the relationship path between two nodes | `graphify_path("AuthService", "DatabasePool")` |
| `graphify_explain` | Everything the graph knows about one node | `graphify_explain("UserController")` |
| `graphify_build` | Rebuild or update the graph (use `--update` for incremental) | `graphify_build({ update: true })` |

## Options

- `graphify_query` supports `--dfs` for depth-first path tracing and `--budget N` to cap returned tokens
- `graphify_build` supports `--mode deep` for aggressive inferred edge extraction
