import { useState } from "react";

export interface Attachment {
  dataUrl: string;
  mimeType: string;
  name?: string;
}

export interface FileAttachment {
  name: string;
  content: string;
}

/**
 * Input-bar state: draft text, attachments (images → data URLs, text files
 * → content), and the submit pipeline (builds the pi-compatible prompt with
 * `<file>` tags and calls back with the final text + images).
 */
export function useChatInput() {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);

  /** Convert picked files: images → base64 data URLs, text files → content. */
  const attachFiles = (files: File[]): void => {
    const images: Attachment[] = [];
    const texts: FileAttachment[] = [];
    let pending = 0;
    for (const f of files) {
      if (f.type.startsWith("image/")) {
        pending++;
        const reader = new FileReader();
        reader.addEventListener("load", () => {
          images.push({ dataUrl: String(reader.result), mimeType: f.type, name: f.name });
          pending -= 1;
          if (pending === 0) {
            setAttachments((prev) => [...prev, ...images]);
            setFileAttachments((prev) => [...prev, ...texts]);
          }
        });
        reader.readAsDataURL(f);
      } else {
        pending++;
        const reader = new FileReader();
        reader.addEventListener("load", () => {
          texts.push({ name: f.name, content: String(reader.result) });
          pending -= 1;
          if (pending === 0) {
            setAttachments((prev) => [...prev, ...images]);
            setFileAttachments((prev) => [...prev, ...texts]);
          }
        });
        reader.readAsText(f);
      }
    }
    if (pending === 0) {
      setAttachments((prev) => [...prev, ...images]);
      setFileAttachments((prev) => [...prev, ...texts]);
    }
  };

  const removeAttachment = (index: number): void => {
    const imgCount = attachments.length;
    if (index < imgCount) {
      setAttachments((prev) => prev.filter((_, i) => i !== index));
    } else {
      setFileAttachments((prev) => prev.filter((_, i) => i !== index - imgCount));
    }
  };

  /** Build the final prompt (text + `<file>` wrappers) and clear the bar. */
  const submit = (onSend: (fullText: string, images: Attachment[]) => void): void => {
    const text = input.trim();
    if ((!text && attachments.length === 0 && fileAttachments.length === 0)) return;
    setInput("");
    const images = attachments;
    setAttachments([]);
    const fileText = fileAttachments.map((f) => `<file name="${f.name}">\n${f.content}\n</file>`).join("\n");
    const fullText = [text, fileText].filter(Boolean).join("\n\n");
    setFileAttachments([]);
    onSend(fullText, images);
  };

  return { input, setInput, attachments, fileAttachments, attachFiles, removeAttachment, submit };
}
