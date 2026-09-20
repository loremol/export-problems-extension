# Changelog

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-09-19

### Added

- Show the cause of a failure in one notification line. Include a Node or VS Code error code only if the message does not already include it, replace line breaks with spaces, and shorten text longer than 300 characters.
- Show how many diagnostics `exportProblems.minimumSeverity` excluded in the export confirmation. The confirmation also explains that exports ignore the Problems panel's filter box.

### Changed

- Name the failed step in export error notifications.
- Confirm successful exports in every output mode.

### Fixed

- When a report is written but cannot be opened, show a warning instead of saying the export failed. The warning includes the file path and the reason it could not be opened.
- Replace VS Code's `Running the contributed command: 'export-problems.export' failed.` message with one that names the failed step and its cause. The Extension Host log still receives the original error and stack.
- Exclude the current export target from collected diagnostics in every output mode. This prevents linter errors from a previous export from appearing in the next one. If a `save-dialog` export uses a name other than `exportProblems.defaultFileName`, the extension does not know that path during collection, so a later export may still include it.
- When `exportProblems.minimumSeverity` removes every diagnostic, report the threshold and the number excluded instead of `No problems found in workspace.`

## [1.1.3] - 2026-09-17

### Added

- Add regression tests for out-of-range diagnostic severities in every layout and severity threshold. Also test non-string settings, messages, and sources; `null` diagnostic codes; save-dialog file name limits; unwritable automatic targets; and permissions for new export files.

### Changed

- Give new automatic `workspace-file` exports the umask-based permissions of a normal file write instead of mode `0600`. File permissions no longer depend on whether the export file already exists.
- Simplify the README settings and development tables to show setting names, types, and defaults. Clarify that multi-root exports include workspace folder names in file paths instead of adding folder headings.

### Fixed

- Label diagnostics with a severity outside VS Code's declared range as `Unknown severity` and place them in a final group. The summary count now matches the exported content, and `undefined` no longer appears in the output. These diagnostics are included at every minimum severity because they cannot be compared with the threshold.
- Use a setting's declared default when its value is not a string. Convert non-string diagnostic messages and sources to strings instead of failing the export.
- Use the `Hint` threshold when `exportProblems.minimumSeverity` is not one of the four supported severity names, including names inherited from `Object.prototype`.
- Treat a `null` diagnostic code as missing. Untyped providers may return `null` even though the API declares `undefined`.
- Open a save dialog when an automatic `workspace-file` target or one of its parent directories is not writable, instead of failing the export.
- Add a trailing newline to the `flat-table` layout to match the `file` and `severity` layouts.

### Security

- Clean `exportProblems.defaultFileName` before using it to prefill the save dialog in the default `save-dialog` mode. A workspace setting can no longer point the dialog outside the workspace folder.

## [1.1.2] - 2026-09-14

### Changed

- Change the default export filename to `problems.md`.

## [1.1.1] - 2026-09-14

### Added

- Add VS Code Marketplace and Open VSX release badges to the README.
- Add regression tests for multi-root exports; severity filtering and ordering; every output layout and summary combination; save-dialog, clipboard, and `workspace-file` success and failure paths; diagnostic code formatting; Markdown escaping; and workspace target security across platforms.

### Changed

- Separate the export command from extension activation. Split configuration, diagnostic collection, Markdown generation, target selection, delivery, and completion into documented helpers. Remove an unnecessary copy of the diagnostic array.
- Split workspace target resolution into lexical, existing-path, and canonical validation steps.
- Rename the export workflow test suite and npm test target from `extension` to `exportProblemsToMarkdown`.

### Fixed

- Clean the output directory before each build so packaged extensions do not include old compiled JavaScript.
- Keep backslash-prefixed pipes as literal text inside flat Markdown table cells.
- Create missing parent directories for automatic `workspace-file` exports.

### Security

- Reject automatic export targets that are directories, have a non-directory parent, or are files with multiple hard links. Use a save dialog instead.
- Revalidate automatic targets after creating parent directories and opening the file. Reject symbolic-link traversal, check that the open file descriptor still points to the validated single-link file, and write through that descriptor.
- Create new automatic export files with mode `0600` where supported. Open a save dialog if the filesystem changes during validation or while opening the file.

## [1.1.0] - 2026-09-13

### Added

- Add settings for the summary title and separate settings for its export date and problem count.

### Changed

- Show the summary title by default, but hide its export date and problem count.
- Use H1 file and severity headings when the summary is hidden, and H2 headings when it is shown.

## [1.0.0] - 2026-09-11

### Added

- Add regression tests for Markdown generation and secure `workspace-file` target handling.

### Changed

- In `workspace-file` mode, open a save dialog when the configured target cannot be verified as safe instead of writing to it automatically.

### Security

- Allow automatic exports only to canonical paths inside local workspaces. Reject path traversal and existing symbolic-link path components.
- Replace line breaks in file paths, diagnostic messages, sources, and codes with spaces. Escape pipes inside `flat-table` cells. This prevents input from creating a false heading or extra table row.

## [0.0.1] - 2026-07-12

### Added

- Add the `Export Problems to Markdown` command. It exports all workspace diagnostics (errors, warnings, info, and hints) from the Problems panel to a Markdown file.
- Add these settings:
  - `exportProblems.minimumSeverity`: minimum severity to include.
  - `exportProblems.groupBy`: `file`, `severity`, or `flat-table` output layout.
  - `exportProblems.includeSummary`: show or hide the title, timestamp, and count header.
  - `exportProblems.includeSource`: show or hide the `[source, code]` tag.
  - `exportProblems.includeColumn`: show or hide column numbers in locations.
  - `exportProblems.defaultFileName`: default export file name.
  - `exportProblems.outputMode`: `save-dialog`, `workspace-file`, or `clipboard`.
  - `exportProblems.openAfterExport`: open the exported file after writing.
