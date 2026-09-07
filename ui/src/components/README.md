# Components

Components are grouped by product area, not by widget shape.

- `chat/`: agent message UI, message grouping, tool-call rendering.
- `command/`: global overlays such as quick open, command palette.
- `sidebar/`: activity bar, file tree, conversations, sites, apps, and widgets.
- `files/`: file preview/editing surfaces and code editor wrappers.
- `settings/`: settings tabs and skill management.
- `ui/`: small reusable UI primitives that are not tied to a product area.
- `workspace/`: tab bars, document and process panels, and tab-group layout.

Prefer importing from each folder's `index.ts` at feature boundaries. Keep leaf-to-leaf imports inside the same folder local.
