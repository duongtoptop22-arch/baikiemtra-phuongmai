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

/** Chuẩn hoá lớp để so sánh: bỏ dấu, viết thường, bỏ ký tự lạ. */
function normalizeClass(raw: string | null): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Gộp ký tự lặp liền nhau ("huyyyy" -> "huy", "anhh" -> "anh") để bắt tên spam ký tự. */
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
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n] ?? 0;
}

/**
 * Xuất danh sách sinh viên đã làm bài ra file Word (.doc).
 * Mỗi học sinh chỉ chiếm MỘT dòng: các lượt làm có tên + lớp trùng nhau
 * (hoặc viết tương tự kiểu spam ký tự như "anhh", "huyyyy") được gộp làm một người.
 * Cột: 1 STT, 2 Tên, 3 Lớp, 4 MSV, 5 Điểm, 6 Ghi chú (số lần làm, điểm từng lần,
 * rời tab, tên viết tương tự, chưa nộp…).
 */
export function exportAttemptsToWord(opts: {
  examTitle: string;
  subject?: string | null;
  rows: WordAttemptRow[];
}) {
  const rows = opts.rows;

  // Chuẩn hoá tên + lớp của từng lượt làm.
  const norm = rows.map((r) => normalizeName(r.student_name));
  const coll = norm.map(collapseRepeats);
  const klass = rows.map((r) => normalizeClass(r.student_class));
  const firstWord = (s: string) => s.split(" ")[0] ?? "";

  // Lớp chỉ được coi là trùng khi cả hai đều có và giống nhau;
  // nếu một bên chưa nhập lớp thì không dùng lớp để phân biệt.
  const sameClass = (i: number, j: number) =>
    !klass[i] || !klass[j] || klass[i] === klass[j];

  // Gom nhóm (union-find): một người = tên + lớp trùng nhau.
  const parent = rows.map((_, i) => i);
  const find = (x: number): number =>
    parent[x] === x ? x : (parent[x] = find(parent[x]!));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (!sameClass(i, j)) continue;
      const ni = norm[i] ?? "";
      const nj = norm[j] ?? "";
      const ci = coll[i] ?? "";
      const cj = coll[j] ?? "";
      // Trùng hẳn (kể cả sau khi gộp ký tự lặp: "anhh" = "anh", "huyyyy" = "huy").
      if (ci === cj) {
        union(i, j);
        continue;
      }
      // Tên viết khác nhau nhưng một trong hai có ký tự lặp (spam) -> so sánh nới lỏng:
      // cùng họ (từ đầu tiên) và lệch ít ký tự, vd "truong thế huy" vs "truong thế hiiiyy".
      // Tên viết chuẩn không có ký tự lặp thì phải trùng hẳn mới gộp,
      // nên "nguyễn dung anh" và "nguyễn dung an" là hai người khác nhau.
      const spam = ci !== ni || cj !== nj;
      if (spam && firstWord(ni) === firstWord(nj)) {
        const dist = levenshtein(ci, cj);
        const limit = Math.max(
          2,
          Math.round((Math.max(ci.length, cj.length) * 15) / 100),
        );
        if (dist <= limit) union(i, j);
      }
    }
  }

  // Gom các lượt làm của từng người theo thứ tự xuất hiện trong danh sách.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const g = find(i);
    const list = groups.get(g) ?? [];
    list.push(i);
    groups.set(g, list);
  }
  const groupOrder = [...groups.keys()];

  // Chọn tên hiển thị: biến thể xuất hiện nhiều nhất (hòa thì chọn biến thể xuất hiện trước).
  const pickName = (idxs: number[]): string => {
    const count = new Map<string, { n: number; first: number }>();
    for (const idx of idxs) {
      const name = rows[idx]!.student_name.trim();
      const key = name.toLowerCase();
      const cur = count.get(key);
      if (cur) cur.n += 1;
      else count.set(key, { n: 1, first: idx });
    }
    let best = "";
    let bestN = -1;
    let bestFirst = Infinity;
    for (const [key, v] of count) {
      if (v.n > bestN || (v.n === bestN && v.first < bestFirst)) {
        best = rows[
          idxs.find((i) => rows[i]!.student_name.trim().toLowerCase() === key)!
        ]!.student_name.trim();
        bestN = v.n;
        bestFirst = v.first;
      }
    }
    return best;
  };

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let stt = 0;
  const body = groupOrder
    .map((g) => {
      const idxs = groups.get(g) ?? [];
      stt += 1;
      const name = pickName(idxs);
      const klassText = rows[idxs[0]!]?.student_class ?? "";

      const notes: string[] = [];
      const totalTabs = idxs.reduce((s, i) => s + (rows[i]!.tab_switches ?? 0), 0);
      if (totalTabs > 0) notes.push(`Chuyển tab ${totalTabs} lần`);
      const total = idxs.length;
      if (total > 1) {
        notes.push(`Đã tham gia ${total} lần`);
        const scores = idxs
          .map((i) => (rows[i]!.score !== null ? `${rows[i]!.score}/10` : "—"))
          .join(", ");
        if (scores) notes.push(`Điểm các lần làm: ${scores}`);
        const variants = [
          ...new Set(
            idxs.map((i) => rows[i]!.student_name.trim()),
          ),
        ].filter((v) => v.toLowerCase() !== name.toLowerCase());
        if (variants.length > 0)
          notes.push(`Tên viết tương tự: ${variants.join(", ")}`);
      }
      if (idxs.some((i) => !rows[i]!.submitted_at)) notes.push("Chưa nộp bài");

      // Điểm cao nhất trong các lượt làm hiển thị ở cột Điểm.
      const scores = idxs
        .map((i) => rows[i]!.score)
        .filter((s): s is number => s !== null);
      let scoreText: string;
      if (scores.length > 0) scoreText = `${Math.max(...scores)}/10`;
      else if (idxs.some((i) => rows[i]!.submitted_at))
        scoreText = "Đã nộp (chưa có điểm)";
      else scoreText = "—";

      return (
        `<tr>` +
        `<td class="c">${stt}</td>` +
        `<td class="name">${escape(name)}</td>` +
        `<td>${escape(klassText)}</td>` +
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
  <p class="meta">Số sinh viên: ${groupOrder.length} · Số lượt làm bài: ${rows.length} · Xuất lúc: ${formatDateTime(new Date().toISOString())}</p>
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
  <p class="meta" style="margin-top:14pt">Ghi chú: mỗi học sinh chỉ chiếm một dòng — các lượt làm có cùng tên và lớp được gộp làm một người, gồm cả tên viết tương tự (thêm bớt ký tự lặp như "anhh", "huyyyy", có/không dấu). Tên khác hẳn (ví dụ "Nguyễn Dung An" khác "Nguyễn Dung Anh") không bị gộp. Cột MSV để trống vì hệ thống không thu thập mã sinh viên. Cột Điểm hiển thị điểm cao nhất; điểm của từng lượt làm ghi ở Ghi chú.</p>
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
