export function substantiveNotes(notes: string): string {
  return notes
    .replace(/办理结果：|依据摘要：|后续事项：/g, "")
    .replace(/\s/g, "");
}
