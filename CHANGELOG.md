# Changelog

All notable changes to the "Export Problems to Markdown" extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-07-12

### Added

- `Export Problems to Markdown` command that exports all workspace diagnostics
  (errors, warnings, info, hints) from the Problems panel to a Markdown file.
- Settings:
  - `exportProblems.minimumSeverity` — minimum severity to include.
  - `exportProblems.groupBy` — `file`, `severity`, or `flat-table` output layout.
  - `exportProblems.includeSummary` — toggle the title/timestamp/count header block.
  - `exportProblems.includeSource` — toggle the `[source, code]` tag.
  - `exportProblems.includeColumn` — toggle column numbers in locations.
  - `exportProblems.defaultFileName` — default export file name.
  - `exportProblems.outputMode` — `save-dialog`, `workspace-file`, or `clipboard`.
  - `exportProblems.openAfterExport` — open the exported file after writing.
