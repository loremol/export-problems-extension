# Changelog
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Describe a failure's cause in one notification line, naming a Node or VS Code error code only when the message does not already carry it, collapsing line breaks, and abbreviating text longer than 300 characters.
- Report the diagnostics excluded because of `exportProblems.minimumSeverity` in the export's confirmation message, alongside a note that the Problems panel's own filter box is not applied to exports.

### Changed

- Name the delivery step in a failed export's notification — copying to the clipboard, opening the save dialog, or writing to a named file — so a failure says which destination it could not reach.
- Confirm a completed export in every output mode. Enabling `openAfterExport` previously opened the report and showed no notification at all, so the same export reported different amounts depending on its mode, and the excluded-diagnostics count went unreported in the default configuration. The confirmation message and everything appended to it no longer depend on the output mode.

### Fixed

- Report a failed export in the extension's own words instead of VS Code's `Running the contributed command: 'export-problems.export' failed.`, which named neither the step that failed nor its cause. The original error, stack included, still reaches the Extension Host log.
- Exclude the configured export target from the diagnostics an export collects, in every output mode, so a linter's complaints about a previous export no longer appear in the next one. A `save-dialog` export saved under a name other than `exportProblems.defaultFileName` is still unknown at collection time and can be reported by a later export.
- Distinguish an empty export caused by `exportProblems.minimumSeverity` from a workspace with no problems, naming the effective threshold and the number of diagnostics it excluded instead of reporting `No problems found in workspace.`

## [1.1.3] - 2026-09-17

### Added

- Expand regression coverage for out-of-range diagnostic severities across every layout and the severity threshold, non-string settings, non-string diagnostic messages and sources, `null` diagnostic codes, save-dialog file name confinement, unwritable automatic targets, and the mode of a newly created export.

### Changed

- Create new automatic `workspace-file` exports with the umask-derived mode of an ordinary file write instead of mode `0600`, so an export's permissions no longer depend on whether the file already existed.
- Reduce the README settings and development tables to the setting names, types, and defaults, and describe multi-root exports as including workspace folder names in file paths rather than adding folder headings.

### Fixed

- Label diagnostics whose severity falls outside the range VS Code declares as `Unknown severity` and group them in a trailing section, so the summary count and the exported body no longer disagree and `undefined` no longer reaches the output. Such a diagnostic is kept regardless of the configured minimum severity, since it cannot be ordered against the threshold.
- Fall back to the declared default for a setting that is not a string, and stringify non-string diagnostic messages and sources, so such a value no longer aborts the whole export.
- Fall back to the `Hint` threshold for an `exportProblems.minimumSeverity` name that is not one of the four declared severities, including names inherited from `Object.prototype`.
- Treat a `null` diagnostic code as an absent code, as untyped providers can emit one where the API declares `undefined`.
- Fall back to save-dialog confirmation when an automatic `workspace-file` target, or a directory on the way to it, denies writing, instead of failing the export with an error.
- End the `flat-table` layout with a trailing newline, matching the `file` and `severity` layouts.

### Security

- Sanitize `exportProblems.defaultFileName` before it pre-fills the save dialog in the default `save-dialog` output mode, so a workspace setting can no longer aim the dialog outside the workspace folder.

## [1.1.2] - 2026-09-14

### Changed

- Change the default export filename to `problems.md`.

## [1.1.1] - 2026-09-14

### Added

- Add VS Code Marketplace and Open VSX release badges to the README.
- Expand regression coverage for multi-root exports, severity filtering and ordering, every output layout and summary combination, save-dialog, clipboard, and `workspace-file` success and failure paths, diagnostic code formatting, Markdown escaping, and workspace target security across platforms.

### Changed

- Isolate the export command from extension activation, split configuration, diagnostic collection, Markdown generation, target selection, delivery, and completion into documented helpers, and remove a redundant diagnostic-array copy.
- Extracted methods from document workspace target resolution into lexical, existing-path, and canonical validation steps.
- Rename the export workflow test suite and npm test target from `extension` to `exportProblemsToMarkdown`.

### Fixed

- Prevent stale compiled JavaScript from being included in packaged extensions by cleaning the output directory before each build.
- Preserve backslash-prefixed pipes as literal content inside flat Markdown table cells.
- Create missing parent directories for automatic `workspace-file` exports.

### Security

- Reject automatic export targets that are directories, contain non-directory parent components, or are files with multiple hard links, falling back to save-dialog confirmation.
- Bind automatic target validation to the file write by revalidating after parent creation and file opening, refusing symbolic-link traversal, confirming that the opened descriptor still identifies the validated single-link file, and writing through that descriptor.
- Create new automatic export files exclusively with mode `0600` where supported, and fall back to a save dialog when the filesystem changes during validation or opening.

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
