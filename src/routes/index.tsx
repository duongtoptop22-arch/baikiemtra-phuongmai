import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  examStatus,
  statusLabel,
  formatDateTime,
  getCompletedExams,
  type CompletedExam,
  type Exam,
} from "@/lib/exam";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Phòng thi trực tuyến — Danh sách bài kiểm tra" },
      {
        name: "description",
        content:
          "Chọn bài kiểm tra để làm bài trên Google Form với đồng hồ đếm ngược tự động đóng khi hết giờ.",
      },
      { property: "og:title", content: "Phòng thi trực tuyến" },
      {
        property: "og:description",
        content: "Bài kiểm tra Google Form kèm đồng hồ đếm ngược.",
      },
    ],
  }),
  component: Home,
});

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return "Chào buổi sáng";
  if (h < 13) return "Chào buổi trưa";
  if (h < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

function Home() {
  const { data: exams, isLoading } = useQuery({
    queryKey: ["exams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exams")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Exam[];
    },
  });

  const openExams = (exams ?? []).filter((e) => examStatus(e) === "open");
  const scheduledExams = (exams ?? []).filter((e) => examStatus(e) === "scheduled");
  const featured = openExams[0];
  const rest = featured ? exams?.filter((e) => e.id !== featured.id) ?? [] : (exams ?? []);

  return (
    <div className="paper min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl bg-primary font-display text-sm font-bold text-primary-foreground shadow-md shadow-primary/25">
              KT
            </div>
            <div>
              <p className="font-display text-[15px] font-bold leading-tight">Phòng thi</p>
              <p className="text-[11px] text-muted-foreground">Kiểm tra trực tuyến</p>
            </div>
          </div>
          <Link
            to="/auth"
            className="rounded-full border border-border bg-card px-4 py-1.5 text-[13px] font-medium text-foreground shadow-sm transition-all hover:border-primary/40 hover:text-primary"
          >
            Giáo viên
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <section>
          <h1 className="text-[26px] font-bold leading-tight">{greeting()}!</h1>
          <p className="mt-1.5 text-[14px] text-muted-foreground">
            Hôm nay có{" "}
            <span className="font-semibold text-foreground">{openExams.length}</span> bài kiểm tra
            đang mở
            {scheduledExams.length > 0 && (
              <>
                {" "}và <span className="font-semibold text-foreground">{scheduledExams.length}</span>{" "}
                bài sắp diễn ra
              </>
            )}
            .
          </p>
        </section>

        {featured && (
          <Link
            to="/thi/$examId"
            params={{ examId: featured.id }}
            className="relative mt-7 block overflow-hidden rounded-3xl bg-primary p-6 text-primary-foreground shadow-xl shadow-primary/25 transition-transform active:scale-[0.99]"
          >
            <div className="relative z-10">
              <div className="flex items-center gap-2">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-white" />
                </span>
                <span className="text-[11px] font-bold uppercase tracking-[0.14em]">
                  Đang diễn ra
                </span>
              </div>
              <h2 className="mt-3.5 text-[22px] font-bold leading-snug">{featured.title}</h2>
              <p className="mt-1 text-[13px] text-primary-foreground/80">
                {featured.subject ? `${featured.subject} · ` : ""}
                {featured.duration_minutes} phút làm bài
              </p>
              <div className="mt-6 w-full rounded-xl bg-white py-3.5 text-center text-[15px] font-bold text-primary shadow-lg">
                Bắt đầu thi ngay →
              </div>
            </div>
            <div className="pointer-events-none absolute -right-8 -bottom-8 size-36 rounded-full bg-white/10 blur-2xl" />
            <div className="pointer-events-none absolute -left-4 -top-4 size-24 rounded-full bg-white/10 blur-xl" />
          </Link>
        )}

        <section className="mt-9">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[17px] font-bold">Danh sách bài kiểm tra</h2>
            {(exams?.length ?? 0) > 0 && (
              <span className="text-[12px] text-muted-foreground">{exams!.length} bài</span>
            )}
          </div>
          <div className="mt-4 space-y-3">
            {isLoading && (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-[88px] animate-pulse rounded-2xl border border-border bg-card"
                  />
                ))}
              </div>
            )}
            {!isLoading && (exams?.length ?? 0) === 0 && (
              <div className="rounded-2xl border border-dashed border-border p-10 text-center">
                <p className="text-[15px] font-medium text-foreground">
                  Chưa có bài kiểm tra nào
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Bài kiểm tra do giáo viên tạo sẽ xuất hiện tại đây.
                </p>
              </div>
            )}
            {rest.map((exam) => {
              const status = examStatus(exam);
              return (
                <Link
                  key={exam.id}
                  to="/thi/$examId"
                  params={{ examId: exam.id }}
                  className="group block rounded-2xl border border-border bg-card p-4.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-[16px] font-semibold leading-snug">
                        {exam.title}
                      </p>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {exam.subject ? `${exam.subject} · ` : ""}
                        {exam.duration_minutes} phút
                      </p>
                    </div>
                    <StatusChip status={status} />
                  </div>
                  <div className="mt-3.5 flex items-center justify-between border-t border-border/60 pt-3">
                    <p className="text-[12px] text-muted-foreground tabular">
                      Mở: {formatDateTime(exam.open_at)} · Đóng: {formatDateTime(exam.close_at)}
                    </p>
                    <span className="text-[14px] text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary">
                      →
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <CompletedExamsSection />

        <div className="relative mt-12 flex items-center py-2">
          <div className="flex-grow border-t border-border" />
          <span className="flex-shrink-0 px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Khu vực giáo viên
          </span>
          <div className="flex-grow border-t border-border" />
        </div>

        <Link
          to="/auth"
          className="group mt-4 flex items-center justify-between rounded-2xl border border-border bg-card p-4.5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
        >
          <div>
            <p className="font-display text-[15px] font-semibold">Đăng nhập giáo viên</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Quản lý đề thi và xem kết quả
            </p>
          </div>
          <span className="grid size-9 place-items-center rounded-full bg-secondary text-[15px] text-muted-foreground transition-all group-hover:bg-primary/10 group-hover:text-primary">
            →
          </span>
        </Link>
      </main>
    </div>
  );
}

/** Danh sách bài kiểm tra học sinh đã làm xong — lưu trên máy của học sinh. */
function CompletedExamsSection() {
  const [completed, setCompleted] = useState<CompletedExam[]>([]);

  useEffect(() => {
    setCompleted(getCompletedExams());
  }, []);

  if (completed.length === 0) return null;

  return (
    <section className="mt-9">
      <h2 className="text-[17px] font-bold">Bài kiểm tra đã làm</h2>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Lưu trên máy này · Bấm vào để tra cứu điểm và xem lại bài.
      </p>
      <div className="mt-4 space-y-3">
        {completed.map((entry) => (
          <Link
            key={`${entry.examId}:${entry.studentName}`}
            to="/thi/$examId"
            params={{ examId: entry.examId }}
            className="block rounded-2xl border border-border bg-card p-4.5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-[16px] font-semibold leading-snug">
                  {entry.title}
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {entry.studentName}
                  {entry.studentClass ? ` · ${entry.studentClass}` : ""}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                  entry.score !== null
                    ? entry.score >= 8
                      ? "bg-success/15 text-success"
                      : entry.score >= 5
                        ? "bg-primary/10 text-primary"
                        : "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {entry.score !== null ? `${entry.score}/10` : "Đã nộp"}
              </span>
            </div>
            <p className="mt-3 border-t border-border/60 pt-3 text-[12px] text-muted-foreground tabular">
              Nộp lúc: {formatDateTime(entry.submittedAt)}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function StatusChip({ status }: { status: "open" | "closed" | "scheduled" }) {
  const styles =
    status === "open"
      ? "bg-primary/10 text-primary"
      : status === "scheduled"
        ? "bg-accent/60 text-accent-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${styles}`}
    >
      {statusLabel[status]}
    </span>
  );
}
