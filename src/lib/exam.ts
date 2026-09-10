export type Exam = {
  id: string;
  teacher_id: string;
  title: string;
  subject: string | null;
  form_url: string;
  /** 'form' = nhúng Google Form, 'manual' = câu hỏi tự nhập, chấm điểm tự động. */
  mode: string;
  duration_minutes: number;
  open_at: string | null;
  close_at: string | null;
  registration_open: boolean;
  created_at: string;
  updated_at: string;
};

export type ExamStatus = "scheduled" | "open" | "closed";

export function examStatus(exam: Exam, now: Date = new Date()): ExamStatus {
  if (!exam.registration_open) return "closed";
  if (exam.open_at && new Date(exam.open_at) > now) return "scheduled";
  if (exam.close_at && new Date(exam.close_at) <= now) return "closed";
  return "open";
}

export const statusLabel: Record<ExamStatus, string> = {
  scheduled: "Sắp mở",
  open: "Đang mở",
  closed: "Đã đóng",
};

/** Chuyển link Google Form bất kỳ sang dạng nhúng được. */
export function toEmbedUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.includes("embedded=true")) return trimmed;
  const sep = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${sep}embedded=true`;
}


export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Thời điểm bắt buộc kết thúc: hết thời lượng hoặc tới giờ đóng. */
export function deadlineFor(exam: Exam, startedAt: number): number {
  const byDuration = startedAt + exam.duration_minutes * 60_000;
  if (exam.close_at) return Math.min(byDuration, new Date(exam.close_at).getTime());
  return byDuration;
}

/** Số giây còn lại đến khi bài thi đóng (dựa trên close_at). Null nếu không có giờ đóng. */
export function secondsToClose(exam: Exam, now: Date = new Date()): number | null {
  if (!exam.close_at) return null;
  return Math.max(0, (new Date(exam.close_at).getTime() - now.getTime()) / 1000);
}

export function startKey(examId: string) {
  return `exam-start:${examId}`;
}
