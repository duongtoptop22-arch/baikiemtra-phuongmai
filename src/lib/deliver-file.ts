/**
 * Tải file về máy tương thích cả điện thoại.
 * - Máy cảm ứng (iPhone/iPad): dùng bảng chia sẻ của hệ điều hành để lưu vào Files/Word.
 * - Máy tính & Android: tải thẳng về qua thẻ <a download>.
 * Gọi trực tiếp trong trình xử lý click để giữ "user activation" (Safari yêu cầu).
 */
export function deliverFile(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type });
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (touch && typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    // iOS Safari không tải blob qua thẻ <a> — phải dùng share sheet.
    navigator
      .share({ files: [file], title: filename })
      .catch((e: unknown) => {
        // Người dùng bấm Huỷ trong bảng chia sẻ — không phải lỗi.
        if ((e as DOMException)?.name !== "AbortError") downloadBlob(blob, filename);
      });
    return;
  }
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
