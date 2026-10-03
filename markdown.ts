// Authority parsers must ignore examples, not interpret fenced code as headings/status.
export function withoutFences(text: string): string {
  let fence: { marker: string; length: number } | undefined;
  return text.split('\n').map(line => {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence && match) { fence = { marker: match[1][0], length: match[1].length }; return ''; }
    if (fence) {
      if (match && match[1][0] === fence.marker && match[1].length >= fence.length && !match[2].trim()) fence = undefined;
      return '';
    }
    return line;
  }).join('\n');
}
