import * as path from 'node:path';
import type * as vscode from 'vscode';

export class TestPosition implements vscode.Position {
  constructor(
    public readonly line: number,
    public readonly character: number
  ) {}

  compareTo(other: vscode.Position): number {
    return this.line - other.line || this.character - other.character;
  }

  isBefore(other: vscode.Position): boolean {
    return this.compareTo(other) < 0;
  }

  isBeforeOrEqual(other: vscode.Position): boolean {
    return this.compareTo(other) <= 0;
  }

  isAfter(other: vscode.Position): boolean {
    return this.compareTo(other) > 0;
  }

  isAfterOrEqual(other: vscode.Position): boolean {
    return this.compareTo(other) >= 0;
  }

  isEqual(other: vscode.Position): boolean {
    return this.compareTo(other) === 0;
  }

  translate(
    lineOrChange: number | { lineDelta?: number; characterDelta?: number } = 0,
    characterDelta = 0
  ): vscode.Position {
    const lineDelta = typeof lineOrChange === 'number' ? lineOrChange : lineOrChange.lineDelta ?? 0;
    const nextCharacterDelta =
      typeof lineOrChange === 'number' ? characterDelta : lineOrChange.characterDelta ?? 0;
    return new TestPosition(this.line + lineDelta, this.character + nextCharacterDelta);
  }

  with(
    lineOrChange: number | { line?: number; character?: number } = this.line,
    character = this.character
  ): vscode.Position {
    const line = typeof lineOrChange === 'number' ? lineOrChange : lineOrChange.line ?? this.line;
    const nextCharacter =
      typeof lineOrChange === 'number' ? character : lineOrChange.character ?? this.character;
    return new TestPosition(line, nextCharacter);
  }
}

export class TestRange implements vscode.Range {
  readonly start: vscode.Position;
  readonly end: vscode.Position;

  constructor(start: vscode.Position, end: vscode.Position) {
    [this.start, this.end] = start.isBeforeOrEqual(end) ? [start, end] : [end, start];
  }

  get isEmpty(): boolean {
    return this.start.isEqual(this.end);
  }

  get isSingleLine(): boolean {
    return this.start.line === this.end.line;
  }

  contains(value: vscode.Position | vscode.Range): boolean {
    if ('start' in value) {
      return this.start.isBeforeOrEqual(value.start) && this.end.isAfterOrEqual(value.end);
    }
    return this.start.isBeforeOrEqual(value) && this.end.isAfterOrEqual(value);
  }

  isEqual(other: vscode.Range): boolean {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }

  intersection(other: vscode.Range): vscode.Range | undefined {
    const start = this.start.isAfter(other.start) ? this.start : other.start;
    const end = this.end.isBefore(other.end) ? this.end : other.end;
    return start.isAfter(end) ? undefined : new TestRange(start, end);
  }

  union(other: vscode.Range): vscode.Range {
    const start = this.start.isBefore(other.start) ? this.start : other.start;
    const end = this.end.isAfter(other.end) ? this.end : other.end;
    return new TestRange(start, end);
  }

  with(
    startOrChange: vscode.Position | { start?: vscode.Position; end?: vscode.Position } = this.start,
    end = this.end
  ): vscode.Range {
    const start = 'line' in startOrChange ? startOrChange : startOrChange.start ?? this.start;
    const nextEnd = 'line' in startOrChange ? end : startOrChange.end ?? this.end;
    return new TestRange(start, nextEnd);
  }
}

export class TestUri implements vscode.Uri {
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  constructor(
    readonly scheme: string,
    readonly fsPath: string,
    components: Partial<Pick<vscode.Uri, 'authority' | 'path' | 'query' | 'fragment'>> = {}
  ) {
    this.authority = components.authority ?? '';
    this.path = components.path ?? fsPath.split(path.sep).join('/');
    this.query = components.query ?? '';
    this.fragment = components.fragment ?? '';
  }

  static file(filePath: string): vscode.Uri {
    return new TestUri('file', path.resolve(filePath));
  }

  static joinPath(base: vscode.Uri, ...segments: string[]): vscode.Uri {
    return new TestUri(base.scheme, path.resolve(base.fsPath, ...segments), {
      authority: base.authority,
      query: base.query,
      fragment: base.fragment,
    });
  }

  with(change: Parameters<vscode.Uri['with']>[0]): vscode.Uri {
    return new TestUri(change.scheme ?? this.scheme, this.fsPath, {
      authority: change.authority ?? this.authority,
      path: change.path ?? this.path,
      query: change.query ?? this.query,
      fragment: change.fragment ?? this.fragment,
    });
  }

  toString(): string {
    return `${this.scheme}:${this.path}`;
  }

  toJSON(): ReturnType<vscode.Uri['toJSON']> {
    return {
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
    };
  }
}

export function createRange(
  startLine = 0,
  startCharacter = 0,
  endLine = startLine,
  endCharacter = startCharacter + 1
): vscode.Range {
  return new TestRange(
    new TestPosition(startLine, startCharacter),
    new TestPosition(endLine, endCharacter)
  );
}
