import { useEffect, useRef, useState, type FormEvent } from "react";
import { addAttachment } from "@/store/attachments";
import { uploadPendingAttachment } from "@/oss/upload";
import { createTask } from "@/store/tasks";
import { showToast } from "@/utils/toast";

interface QuickCaptureProps {
  mode: "sheet" | "overlay";
  onClose: () => void;
}

interface RecognitionResultLike {
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
}

interface RecognitionEventLike {
  readonly resultIndex: number;
  readonly results: RecognitionResultLike[];
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

export function QuickCapture({ mode, onClose }: QuickCaptureProps) {
  const [captureSessionId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const speechWindow = window as SpeechWindow;
  const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    if (mode !== "sheet") return;
    const viewport = window.visualViewport;
    const updateHeight = () => {
      formRef.current?.style.setProperty(
        "--worklog-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`
      );
    };
    updateHeight();
    viewport?.addEventListener("resize", updateHeight);
    viewport?.addEventListener("scroll", updateHeight);
    return () => {
      viewport?.removeEventListener("resize", updateHeight);
      viewport?.removeEventListener("scroll", updateHeight);
    };
  }, [mode]);

  function startVoiceInput() {
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .map((result) => result[0]?.transcript ?? "")
        .join("");
      setNotes((current) => `${current}${current ? "\n" : ""}${transcript}`);
      setSpeaking(false);
    };
    recognition.onerror = () => {
      setSpeaking(false);
      setError("语音输入失败，请检查麦克风权限后重试");
    };
    setSpeaking(true);
    try {
      recognition.start();
    } catch (voiceError: unknown) {
      setSpeaking(false);
      setError(voiceError instanceof Error ? voiceError.message : "无法启动语音输入");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setError("请填写任务标题");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const task = await createTask({ title, notes, captureSessionId });
      for (const file of files) {
        const attachment = await addAttachment({ taskId: task.id, file, role: "other" });
        try {
          await uploadPendingAttachment(attachment.id, () => undefined);
        } catch (uploadError: unknown) {
          showToast(
            uploadError instanceof Error
              ? uploadError.message
              : "照片已保存在本机待上传队列"
          );
        }
      }
      showToast("已记，待同步");
      setTitle("");
      setNotes("");
      setFiles([]);
      if (mode === "overlay") {
        document.getElementById("quick-capture-title")?.focus();
      } else {
        onClose();
      }
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-30 flex ${
        mode === "sheet" ? "items-end bg-slate-950/40" : "items-center justify-center bg-slate-950/50 p-4"
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && mode === "overlay") onClose();
      }}
    >
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        style={
          mode === "sheet"
            ? { maxHeight: "min(90dvh, var(--worklog-viewport-height, 100dvh))" }
            : undefined
        }
        className={`w-full overflow-y-auto overscroll-contain bg-white p-5 shadow-2xl ${
          mode === "sheet"
            ? "rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            : "max-w-xl rounded-2xl"
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">快速记一条</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-500">
            关闭
          </button>
        </div>
        <label className="mt-4 grid gap-1.5 text-sm font-medium text-slate-700" htmlFor="quick-capture-title">
          标题
          <input
            id="quick-capture-title"
            required
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-3 text-base font-normal outline-none focus:border-blue-600"
            placeholder="简要记录要处理的事项"
          />
        </label>
        <label className="mt-4 grid gap-1.5 text-sm font-medium text-slate-700" htmlFor="quick-capture-notes">
          备注
          <textarea
            id="quick-capture-notes"
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="resize-y rounded-lg border border-slate-300 px-3 py-3 font-normal outline-none focus:border-blue-600"
            placeholder="可稍后补充依据和过程"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {SpeechRecognition && (
            <button
              type="button"
              onClick={startVoiceInput}
              disabled={speaking}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
            >
              {speaking ? "正在听…" : "语音输入"}
            </button>
          )}
          <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
            拍照 / 选择照片
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(event) => setFiles((current) => [...current, ...Array.from(event.target.files ?? [])])}
            />
          </label>
          {files.length > 0 && (
            <span className="text-xs text-slate-500">{files.map((file) => file.name).join("、")}</span>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">照片暂存到本机待上传队列，本阶段不会上传。</p>
        {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="mt-5 w-full rounded-lg bg-navy px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "正在保存…" : mode === "overlay" ? "保存并继续记录" : "保存"}
        </button>
      </form>
    </div>
  );
}
