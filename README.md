# Export Problems to Markdown

[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/loremol.export-problems-to-markdown.svg)](https://marketplace.visualstudio.com/items?itemName=loremol.export-problems-to-markdown)
[![Open VSX Registry](https://img.shields.io/open-vsx/v/loremol/export-problems-to-markdown?label=Open%20VSX)](https://open-vsx.org/extension/loremol/export-problems-to-markdown)

Export diagnostics from the VS Code or VSCodium Problems panel to Markdown, in a file or in the clipboard. You can choose which problems to include, how to group them, and where to save the result.

## Features

- Export errors, warnings, information, and hints from the entire workspace.
- Include the line and column, severity, source, code, and message for each problem.
- Group problems by file or severity, or place them in a single table.
- Send the output to a location chosen in a save dialog, write it to the workspace automatically, or copy it to the clipboard.
- Set a minimum severity and choose whether to include the header, source and code tags, or column numbers.
- Reject unsafe user-provided paths and open a new save dialog instead.
- Include workspace folder names in file paths when the window contains multiple workspace folders.

See [Settings](#settings) for all options.

## Usage

1. Open the Command Palette
2. Run **Export Problems to Markdown**.

Example output with the default settings:

```markdown
# Problems

## src/index.ts

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

### Grouping with `groupBy`

- `file`: one heading per file.
- `severity`: one heading per severity.
- `flat-table`: a single Markdown table, one row per diagnostic.

### Summary

By enabling `includeSummary` and `summaryTitle` you get an H1 header named after `summaryTitle`. The other two options `includeExportDate` and `includeProblemCount` enable the writing of some informative data under the summary header. They are disabled by default. 

## Development commands

```sh
npm ci
npm run compile
npm test
npm run package
```
