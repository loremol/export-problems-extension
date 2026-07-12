# Export Problems to Markdown
Export everything in the VS Code / VSCodium "Problems" panel to a Markdown file, grouped by file.

## Features
- Exports all diagnostics (errors, warnings, info, hints) across the whole workspace, not just open files.
- Each entry shows line:column, severity, source, code, and message.
- Configurable layout: group by file, group by severity, or a single flat table.
- Configurable output: save dialog, silent write to the workspace root, or copy to the clipboard.
- Filter by minimum severity, and toggle the header block, source/code tags, and column numbers.

See [Settings](#settings) for all options.

## Usage
1. Open the Command Palette
2. Run **Export Problems to Markdown**.

Example output:

```markdown
# Problems Export
Generated: 2026-07-12T10:00:00.000Z
Total problems: 2 across 1 file(s)

## src/index.ts
- **Line 12:5** Error [ts, 2322]: Type 'string' is not assignable to type 'number'.
- **Line 30:1** Warning [eslint, no-unused-vars]: 'foo' is declared but never used.
```

## Settings
| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `exportProblems.minimumSeverity` | `Hint` \| `Information` \| `Warning` \| `Error` | `Hint` | Minimum severity to include (`Hint` includes everything, `Error` includes only errors). |
| `exportProblems.groupBy` | `file` \| `severity` \| `flat-table` | `file` | How diagnostics are organized (see below). |
| `exportProblems.includeSummary` | boolean | `true` | Include the title, timestamp, and total-count header block. |
| `exportProblems.includeSource` | boolean | `true` | Include the `[eslint, no-unused-vars]` source/code tag. |
| `exportProblems.includeColumn` | boolean | `true` | Include the column number (`Line 42:8` vs `Line 42`). |
| `exportProblems.defaultFileName` | string | `problems-export.md` | File name pre-filled in the save dialog / used for `workspace-file` mode. |
| `exportProblems.outputMode` | `save-dialog` \| `workspace-file` \| `clipboard` | `save-dialog` | Where output goes: native dialog, silent write to the workspace root, or the clipboard. |
| `exportProblems.openAfterExport` | boolean | `true` | Open the exported file after writing (ignored for `clipboard`). |

### Grouping (`groupBy`)

- `file`: one `## <path>` section per file (default, shown above).
- `severity`: one section per severity (`## Errors`, `## Warnings`, ...), with the file path in each entry.
- `flat-table`: a single Markdown table, one row per diagnostic:
```markdown
| Severity | File | Line | Source | Message |
| --- | --- | --- | --- | --- |
| Error | src/index.ts | 12:5 | ts, 2322 | Type 'string' is not assignable to type 'number'. |
```
