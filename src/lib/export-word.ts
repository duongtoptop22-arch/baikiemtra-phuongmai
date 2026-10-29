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

/** Chuẩn hoá tên để so sánh: bỏ dấu tiếng Việt, viết thường, bỏ ký tự lạ. */
function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Gộp ký tự lặp liền nhau ("huyyyy" -> "huy") để bắt tên spam ký tự. */
function collapseRepeats(s: string): string {
  return s.replace(/(.)\1+/g, "$1");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

/**
 * Xuất danh sách sinh viên đã làm bài ra file Word (.doc).
 * Cột: 1 Tên, 2 Lớp, 3 MSV, 4 Điểm, 5 Ghi chú (rời tab, số lần làm bài, chưa nộp…).
 * Tự phát hiện tên trùng / viết tương tự nhau (vd "Trương Thế Huy" vs
 * "truong thế huyyyy") và gộp vào một nhóm, ghi rõ lần làm thứ mấy.
 */
export function exportAttemptsToWord(opts: {
  examTitle: string;
  subject?: string | null;
  rows: WordAttemptRow[];
}) {
  const rows = opts.rows;

  // Gom nhóm tên trùng / tương tự nhau (union-find) để đếm số lượt làm bài.
  const norm = rows.map((r) => normalizeName(r.student_name));
  const coll = norm.map(collapseRepeats);
  const parent = rows.map((_, i) => i);
  const find = (x: number): number =>
    parent[x] === x ? x : (parent[x] = find(parent[x]));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const firstWord = (s: string) => s.split(" ")[0] ?? "";
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const ni = norm[i] ?? "";
      const nj = norm[j] ?? "";
      if (coll[i] === coll[j]) {
        union(i, j);
        continue;
      }
      // Tên viết khác nhau nhưng giống nhau về mặt chữ: cùng họ (từ đầu tiên)
      // và lệch nhau ít ký tự -> coi là một học sinh spam tên.
      const dist = levenshtein(coll[i] ?? "", coll[j] ?? "");
      const limit = Math.max(
        2,
        Math.round((Math.max((coll[i] ?? "").length, (coll[j] ?? "").length) * 15) / 100),
      );
      if (dist <= limit && firstWord(ni) === firstWord(nj)) union(i, j);
    }
  }

  // Đếm số lượt theo nhóm và gom các biến thể tên của mỗi nhóm.
  const groupCount = new Map<number, number>();
  const groupVariants = new Map<number, string[]>();
  for (let i = 0; i < rows.length; i++) {
    const g = find(i);
    groupCount.set(g, (groupCount.get(g) ?? 0) + 1);
    const name = rows[i].student_name.trim();
    const list = groupVariants.get(g) ?? [];
    if (!list.some((n) => n.toLowerCase() === name.toLowerCase())) list.push(name);
    groupVariants.set(g, list);
  }
  const seenByGroup = new Map<number, number>();

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const body = rows
    .map((r, i) => {
      const notes: string[] = [];
      if (r.tab_switches > 0) notes.push(`Chuyển tab ${r.tab_switches} lần`);
      const g = find(i);
      const total = groupCount.get(g) ?? 1;
      if (total > 1) {
        const n = (seenByGroup.get(g) ?? 0) + 1;
        seenByGroup.set(g, n);
        notes.push(`Tham gia làm bài ${n}/${total} lần`);
        const variants = (groupVariants.get(g) ?? []).filter(
          (v) => v.toLowerCase() !== r.student_name.trim().toLowerCase(),
        );
        if (variants.length > 0)
          notes.push(`Tên viết tương tự: ${variants.join(", ")}`);
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
  <p class="meta" style="margin-top:14pt">Ghi chú: cột MSV để trống vì hệ thống không thu thập mã sinh viên; các ghi chú gồm số lần rời tab trong lúc thi, lượt làm bài thứ mấy và trạng thái nộp bài. Các tên trùng nhau hoặc viết tương tự (thêm bớt ký tự, có/không dấu) được gộp làm một và ghi rõ các biến thể tên ở cột Ghi chú.</p>
</body>
</html>`;

  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  const safeTitle = opts.examTitle
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  deliverFile(blob, `danh-sach-lam-bai-${safeTitle || "bai-kiem-tra"}.doc`);
}
