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

/** Bài kiểm tra học sinh đã làm xong — lưu trên chính máy của học sinh (localStorage). */
export type CompletedExam = {
  examId: string;
  title: string;
  subject: string | null;
  studentName: string;
  studentClass: string | null;
  score: number | null;
  submittedAt: string;
};

const COMPLETED_KEY = "completed-exams";

export function getCompletedExams(): CompletedExam[] {
  try {
    const raw = localStorage.getItem(COMPLETED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CompletedExam[]) : [];
  } catch {
    return [];
  }
}

export function saveCompletedExam(entry: CompletedExam) {
  try {
    const list = getCompletedExams().filter(
      (e) => !(e.examId === entry.examId && e.studentName === entry.studentName),
    );
    list.unshift(entry);
    localStorage.setItem(COMPLETED_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* bộ nhớ đầy hoặc bị chặn — bỏ qua */
  }
}

/** Kiểm tra họ tên: chỉ gồm chữ cái, ít nhất 3 từ (họ + đệm + tên), mỗi từ tối thiểu 2 ký tự. */
export function validateFullName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const words = trimmed.split(" ").filter(Boolean);
  if (!trimmed) return "Nhập đầy đủ họ và tên để bắt đầu làm bài.";
  if (!/^[a-zA-Zà-ỹđĐ\s]+$/.test(trimmed)) return "Họ tên chỉ chấp nhận chữ cái, không có ký tự lạ.";
  if (words.length < 3) return "Nhập đầy đủ họ và tên (ví dụ: DANG NGOC DUONG).";
  if (words.some((w) => w.length < 2)) return "Nhập đầy đủ họ và tên (ví dụ: DANG NGOC DUONG).";
  return null;
}

/** Kiểm tra lớp: phải bắt đầu bằng chữ K (ví dụ: K19B SPAN). */
export function validateKlass(klass: string): string | null {
  const trimmed = klass.trim();
  if (!trimmed) return "Nhập lớp của bạn.";
  if (!/^k/i.test(trimmed)) return "Lớp phải bắt đầu bằng chữ K (ví dụ: K19B SPAN).";
  if (!/^[kK][a-zA-Z0-9à-ỹđĐ\s\-.]+$/.test(trimmed)) return "Mã lớp chỉ gồm chữ, số và khoảng trắng.";
  return null;
}

/**
 * Trộn mảng theo hạt giống (dùng để đảo thứ tự câu hỏi cho từng học sinh).
 * Cùng hạt seed cho cùng kết quả, nên thứ tự giữ nguyên khi học sinh tải lại trang.
 */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const rand = () => {
    // mulberry32
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}
