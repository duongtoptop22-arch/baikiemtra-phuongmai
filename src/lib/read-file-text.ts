/** Đọc văn bản từ tệp PDF, Word (.docx) hoặc văn bản thuần — chạy trong trình duyệt. */
export async function readFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const parts: string[] = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      parts.push(
        content.items
          .map((it) => ("str" in it ? (it as { str: string }).str : ""))
          .join(" "),
      );
    }
    return parts.join("\n");
  }

  if (name.endsWith(".docx")) {
    const mammoth = (await import(
      /* @vite-ignore */ "mammoth/mammoth.browser.js"
    )) as unknown as {
      extractRawText: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
    };
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value;
  }

  if (name.endsWith(".doc")) {
    throw new Error("Tệp .doc cũ chưa hỗ trợ — hãy lưu lại thành .docx hoặc PDF.");
  }

  return await file.text();
}
