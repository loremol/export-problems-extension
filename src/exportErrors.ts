// Maximum cause length before a notification abbreviates it.
const maximumCauseLength = 300;

// Check for the string error codes used by Node and VS Code.
function hasErrorCode(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

// Keep the cause and code suffix within the notification limit.
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

// Add terminal punctuation when the text does not already have it.
export function endSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

// Turn a thrown value into useful notification text.
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

// Wrap an error with the name of the export step that failed.
export class ExportStepError extends Error {
  constructor(readonly step: string, cause: unknown) {
    super(`${step}: ${describeError(cause)}`, { cause });
    this.name = 'ExportStepError';
  }
}

// Run one export step and attach its name to any error.
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

// Format an export error for a notification.
export function formatExportFailure(error: unknown): string {
  return error instanceof ExportStepError
    ? endSentence(`Could not ${error.step}: ${describeError(error.cause)}`)
    : endSentence(`Export Problems to Markdown failed: ${describeError(error)}`);
}
