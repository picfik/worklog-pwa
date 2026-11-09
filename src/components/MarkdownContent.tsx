import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useState } from "react";

export function MarkdownContent({ source }: { source: string }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let active = true;
    Promise.resolve(marked.parse(source || ""))
      .then((result) => {
        if (active) {
          setHtml(DOMPurify.sanitize(result));
        }
      })
      .catch((error: unknown) => {
        console.error("Markdown 渲染失败", error);
        if (active) {
          setHtml("");
        }
      });
    return () => {
      active = false;
    };
  }, [source]);

  return (
    <div
      className="markdown-content min-h-32 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
