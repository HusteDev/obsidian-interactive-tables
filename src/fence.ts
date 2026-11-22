/*
 * Fence lines inside callouts and list items carry a prefix ("> ", "  ") that the
 * rtable body lines share. These helpers read and rebuild that prefix.
 */
const FENCE_LINE = /^([ \t>]*)(```|~~~)/;

/** The quote/indent prefix of a code fence line, or null if the line isn't a fence. */
export function fencePrefix(line: string): string | null {
  const m = FENCE_LINE.exec(line);
  return m ? m[1] : null;
}

export function isFenceLine(line: string): boolean {
  return FENCE_LINE.test(line);
}

/** The line without its leading quote markers and indentation. */
export function stripPrefix(line: string): string {
  return line.replace(/^[ \t>]+/, "");
}

/** The leading quote markers and indentation of any line. */
export function prefixOf(line: string): string {
  return /^[ \t>]*/.exec(line)![0];
}
