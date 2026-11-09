const DOCUMENT_NUMBER_PATTERN = /〔\d{4}〕\d+号|\[\d{4}\]\d+号/g;

export function extractDocumentNumbers(value: string): string[] {
  return Array.from(new Set(value.match(DOCUMENT_NUMBER_PATTERN) ?? []));
}
