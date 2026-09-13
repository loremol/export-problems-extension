# Changelog
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-09-13

### Added

- Add settings to customize the summary title and independently toggle its export date and problem count.

### Changed

- Include the summary title by default while omitting its export date and problem count.
- Promote file and severity group headings to H1 when the summary is omitted, while retaining H2 beneath an included summary.

## [1.0.0] - 2026-09-11

### Added

- Automated regression tests for Markdown generation and secure `workspace-file` target handling.

### Changed

- `workspace-file` mode now opens a save dialog instead of writing silently when the configured target cannot be verified as safe.

### Security

- Restrict automatic exports to canonical targets strictly beneath local workspaces, rejecting path traversal and existing symbolic-link components.
- Escape file paths, diagnostic messages, sources, and codes so Markdown and HTML-like input renders as literal text.

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
