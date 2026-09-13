# Export Problems to Markdown
Export everything in the VS Code / VSCodium "Problems" panel to a Markdown file with customizable filtering, grouping and export options.

## Features
- Exports all diagnostics (errors, warnings, info, hints) across the whole workspace.
- Each entry shows line:column, severity, source, code, and message.
- Configurable layout: group by file, group by severity, or a single flat table.
- Configurable output:
    1. specify the output every time with save dialog
    2. automatic file write in the workspace
    3. copy to the clipboard
- Filter by minimum severity, and toggle the header block, source/code tags, and column numbers.
- Insecure paths submitted by the user are rejected and prompt a new save dialog

See [Settings](#settings) for all options.

## Usage
1. Open the Command Palette
2. Run **Export Problems to Markdown**.

Example output produced:

```markdown
# src/index.ts
- **Line 12:5** Error [ts, 2322]: Type 'string' is not assignable to type 'number'.
- **Line 30:1** Warning [eslint, no-unused-vars]: 'foo' is declared but never used.
```

## Settings
| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `exportProblems.minimumSeverity` | `Hint` \| `Information` \| `Warning` \| `Error` | `Hint` | Minimum severity to include (`Hint` includes everything, `Error` includes only errors). |
| `exportProblems.groupBy` | `file` \| `severity` \| `flat-table` | `file` | How diagnostics are organized (see below). |
| `exportProblems.includeSummary` | boolean | `true` | Include the summary header block. |
| `exportProblems.summaryTitle` | string | `Problems` | H1 title used when the summary is included. |
| `exportProblems.includeExportDate` | boolean | `false` | Include the generation timestamp in the summary. |
| `exportProblems.includeProblemCount` | boolean | `false` | Include the total problem and file count in the summary. |
| `exportProblems.includeSource` | boolean | `true` | Include the `[eslint, no-unused-vars]` source/code tag. |
| `exportProblems.includeColumn` | boolean | `true` | Include the column number (`Line 42:8` vs `Line 42`). |
| `exportProblems.defaultFileName` | string | `problems-export.md` | File name or relative path pre-filled in the save dialog / used for `workspace-file` mode. |
| `exportProblems.outputMode` | `save-dialog` \| `workspace-file` \| `clipboard` | `save-dialog` | Where output goes: native dialog, validated automatic write to a strict descendant of a local workspace, or the clipboard. Other `workspace-file` targets require save-dialog confirmation. |
| `exportProblems.openAfterExport` | boolean | `true` | Open the exported file after writing (ignored for `clipboard`). |

### Grouping (`groupBy`)
- `file`: one heading per file (`## <path>` by default beneath the summary, or `# <path>` when it is disabled).
- `severity`: one heading per severity (`## Errors` by default beneath the summary, or `# Errors` when it is disabled), with the file path in each entry.
- `flat-table`: a single Markdown table, one row per diagnostic:
```markdown
| Severity | File | Line | Source | Message |
| --- | --- | --- | --- | --- |
| Error | src/index.ts | 12:5 | ts, 2322 | Type 'string' is not assignable to type 'number'. |
```

## Development
| Command | Description |
| --- | --- |
| `npm ci` | Install the locked development dependencies. |
| `npm run compile` | Compile the extension into `out/`. |
| `npm test` | Compile and run the extension and security regression tests. |
| `npm run package` | Build the VS Code extension package. |
