# Export Problems to Markdown

[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/loremol.export-problems-to-markdown.svg)](https://marketplace.visualstudio.com/items?itemName=loremol.export-problems-to-markdown)
[![Open VSX Registry](https://img.shields.io/open-vsx/v/loremol/export-problems-to-markdown?label=Open%20VSX)](https://open-vsx.org/extension/loremol/export-problems-to-markdown)

Export everything from the VS Code / VSCodium "Problems" panel to a Markdown file with customizable filtering, grouping and export options.

## Features
- Exports all diagnostics (errors, warnings, info, hints) across the whole workspace.
- Each entry shows line:column, severity, source, code, and message.
- Configurable layout: group by file, group by severity, or by a single flat table.
- Configurable output:
    1. specify the output every time with save dialog
    2. automatic file write in the workspace
    3. copy to the clipboard
- Filter by minimum severity, and toggle the header block, source/code tags, and column numbers.
- Insecure paths submitted by the user are rejected and prompt a new save dialog
- With multiple workspaces open in the same window, it includes workspace folder names in file paths

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
| Setting | Type | Default |
| --- | --- | --- |
| `exportProblems.minimumSeverity` | `Hint` \| `Information` \| `Warning` \| `Error` | `Hint` |
| `exportProblems.groupBy` | `file` \| `severity` \| `flat-table` | `file` |
| `exportProblems.includeSummary` | `boolean` | `true` |
| `exportProblems.summaryTitle` | `string` | `Problems` |
| `exportProblems.includeExportDate` | `boolean` | `false` |
| `exportProblems.includeProblemCount` | `boolean` | `false` |
| `exportProblems.includeSource` | `boolean` | `true` |
| `exportProblems.includeColumn` | `boolean` | `true` |
| `exportProblems.defaultFileName` | `string` | `problems.md` |
| `exportProblems.outputMode` | `save-dialog` \| `workspace-file` \| `clipboard` | `save-dialog` |
| `exportProblems.openAfterExport` | `boolean` | `true` |

### Grouping (`groupBy`)
- `file`: one heading per file (`## <path>` by default beneath the summary, or `# <path>` when it is disabled).
- `severity`: one heading per severity (`## Errors` by default beneath the summary, or `# Errors` when it is disabled), with the file path in each entry.
- `flat-table`: a single Markdown table, one row per diagnostic.

## Development
- `npm ci`
- `npm run compile`
- `npm test`
- `npm run package`
