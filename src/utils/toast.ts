export function showToast(message: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("worklog:toast", { detail: message }));
  }
}
