function safeDownloadName(filename: string): string {
  const name = filename
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return name || "download";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const mime = blob.type.toLowerCase().split(";", 1)[0].trim();
  const extension =
    mime === "application/pdf"
      ? ".pdf"
      : mime === "text/plain"
        ? ".txt"
        : mime === "image/jpeg"
          ? ".jpg"
          : "";
  const name = safeDownloadName(filename);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download =
    extension && !name.toLowerCase().endsWith(extension)
      ? name + extension
      : name;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadText(text: string, filename: string): void {
  downloadBlob(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
    filename,
  );
}
