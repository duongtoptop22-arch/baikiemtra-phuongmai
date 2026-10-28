import { formatDateTime } from "@/lib/exam";
import { deliverFile } from "@/lib/deliver-file";

export type WordAttemptRow = {
  student_name: string;
  student_class: string | null;
  started_at: string;
  submitted_at: string | null;
  tab_switches: number;
  score: number | null;
};

/**
 * Xuất danh sách sinh viên đã làm bài ra file Word (.doc).
 * Cột: 1 Tên, 2 Lớp, 3 MSV, 4 Điểm, 5 Ghi chú (rời tab, số lần làm bài, chưa nộp…).
 */
export function exportAttemptsToWord(opts: {
  examTitle: string;
  subject?: string | null;
  rows: WordAttemptRow[];
}) {
  const rows = opts.rows;
  // Đếm số lượt làm bài theo tên (không phân biệt hoa thường, gộp khoảng trắng).
  const countByName = new Map<string, number>();
  const seenByName = new Map<string, number>();
  for (const r of rows) {
    const key = r.student_name.trim().toLowerCase();
    countByName.set(key, (countByName.get(key) ?? 0) + 1);
  }

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const body = rows
    .map((r, i) => {
      const notes: string[] = [];
      if (r.tab_switches > 0) notes.push(`Chuyển tab ${r.tab_switches} lần`);
      const key = r.student_name.trim().toLowerCase();
      const total = countByName.get(key) ?? 1;
      if (total > 1) {
        const n = (seenByName.get(key) ?? 0) + 1;
        seenByName.set(key, n);
        notes.push(`Tham gia làm bài ${n}/${total} lần`);
      }
      if (!r.submitted_at) notes.push("Chưa nộp bài");

      const scoreText =
        r.score !== null ? `${r.score}/10` : r.submitted_at ? "Đã nộp (chưa có điểm)" : "—";
      return (
        `<tr>` +
        `<td class="c">${i + 1}</td>` +
        `<td class="name">${escape(r.student_name)}</td>` +
        `<td>${escape(r.student_class ?? "")}</td>` +
        `<td class="c">—</td>` +
        `<td class="c score">${escape(scoreText)}</td>` +
        `<td>${escape(notes.join("; "))}</td>` +
        `</tr>`
      );
    })
    .join("");

  const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>Danh sách sinh viên làm bài — ${escape(opts.examTitle)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4 landscape; margin: 1.5cm; }
  body { font-family: "Times New Roman", serif; font-size: 12pt; color: #000; }
  h1 { font-size: 15pt; margin: 0 0 4pt; text-align: center; }
  .sub { text-align: center; font-size: 11pt; color: #444; margin: 0 0 12pt; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #000; padding: 5pt 7pt; vertical-align: top; }
  th { background: #eee; font-size: 11.5pt; }
  td.c { text-align: center; }
  td.score { font-weight: bold; }
  td.name { font-weight: bold; }
  .meta { font-size: 10.5pt; color: #333; margin-bottom: 10pt; }
</style>
</head>
<body>
  <h1>DANH SÁCH SINH VIÊN THAM GIA LÀM BÀI KIỂM TRA</h1>
  <p class="sub">${escape(opts.examTitle)}${opts.subject ? ` — ${escape(opts.subject)}` : ""}</p>
  <p class="meta">Số lượt làm bài: ${rows.length} · Xuất lúc: ${formatDateTime(new Date().toISOString())}</p>
  <table>
    <thead>
      <tr>
        <th style="width:4%">1</th>
        <th style="width:22%">Tên</th>
        <th style="width:12%">Lớp</th>
        <th style="width:12%">MSV</th>
        <th style="width:10%">Điểm</th>
        <th>Ghi chú</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
  <p class="meta" style="margin-top:14pt">Ghi chú: cột MSV để trống vì hệ thống không thu thập mã sinh viên; các ghi chú gồm số lần rời tab trong lúc thi, lượt làm bài thứ mấy và trạng thái nộp bài.</p>
</body>
</html>`;

  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  deliverFile(blob, `danh-sach-lam-bai-${safeTitle || "bai-kiem-tra"}.doc`);
}
