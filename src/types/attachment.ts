export type AttachmentRole = "basis" | "evidence" | "reference" | "draft" | "other";

export interface Attachment {
  id: string;
  taskId: string;
  role: AttachmentRole;
  name: string;
  mime: string;
  ext: string;
  size: number;
  sha256: string;
  ossKey: string;
  uploadedAt: string;
  capturedAt?: string;
  note?: string;
}
