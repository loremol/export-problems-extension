// The longest cause text a notification carries before it is abbreviated
const maximumCauseLength = 300;

// Returns true when a thrown value carries a string code, as both Node and VS Code errors do
function hasErrorCode(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

// Fits cause text and its code suffix into a single readable notification line
function formatCauseText(value: string, suffix = ''): string {
  const combined = `${value}${suffix}`;
  if (combined.length <= maximumCauseLength) {
    return combined;
  }

  if (suffix.length >= maximumCauseLength) {
    return `${combined.slice(0, maximumCauseLength - 1)}…`;
  }

  return `${value.slice(0, maximumCauseLength - suffix.length - 1)}…${suffix}`;
}

// Ends a sentence, leaving text that already ends in terminal punctuation alone
export function endSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

// Names the cause of a failure in a form worth showing in a notification
export function describeError(error: unknown): string {
  const code = hasErrorCode(error) ? error.code : '';
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n]+/g, ' ')
    .trim();

  if (!message) {
    return formatCauseText(code || 'unknown error');
  }

  // Node's errno messages begin with their own code, so repeating it adds nothing.
  const codeSuffix = code && !message.includes(code) ? ` (${code})` : '';
  return formatCauseText(message, codeSuffix);
}

// Marks a failure that already names the export step it interrupted
export class ExportStepError extends Error {
  constructor(readonly step: string, cause: unknown) {
    super(`${step}: ${describeError(cause)}`, { cause });
    this.name = 'ExportStepError';
  }
}

// Runs an export step, tagging any failure with the step it interrupted
export async function runExportStep<T>(
  step: string,
  operation: () => T | PromiseLike<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new ExportStepError(step, error);
  }
}

// Phrases an export failure for a notification
export function formatExportFailure(error: unknown): string {
  return error instanceof ExportStepError
    ? endSentence(`Could not ${error.step}: ${describeError(error.cause)}`)
    : endSentence(`Export Problems to Markdown failed: ${describeError(error)}`);
}
