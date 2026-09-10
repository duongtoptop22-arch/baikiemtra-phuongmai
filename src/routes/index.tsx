import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { examStatus, statusLabel, formatDateTime, type Exam } from "@/lib/exam";

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
      <header className="mx-auto flex max-w-md items-center justify-between px-5 py-6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-primary font-display text-sm text-primary-foreground">
            KT
          </div>
          <div>
            <p className="font-display text-[15px] leading-tight">Phòng thi</p>
            <p className="text-[11px] text-muted-foreground">Kiểm tra trực tuyến</p>
          </div>
        </div>
        <Link
          to="/auth"
          className="rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:border-primary/30"
        >
          Giáo viên
        </Link>
      </header>

      <main className="mx-auto max-w-md px-5 pb-16">
        <section className="flex items-start justify-between">
          <div>
            <h1 className="text-[24px] font-bold leading-tight">Chào buổi sáng!</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Hôm nay có {openExams.length} bài kiểm tra đang mở.
            </p>
          </div>
          <div className="grid size-11 place-items-center rounded-full bg-primary/10">
            <div className="size-7 rounded-full bg-primary border-2 border-white" />
          </div>
        </section>

        {featured && (
          <Link
            to="/thi/$examId"
            params={{ examId: featured.id }}
            className="mt-6 block overflow-hidden rounded-3xl bg-primary p-6 text-primary-foreground shadow-xl shadow-primary/20 transition-transform active:scale-[0.99]"
          >
            <div className="relative z-10">
              <span className="inline-block rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold tracking-wide uppercase backdrop-blur-sm">
                Đang diễn ra
              </span>
              <h2 className="mt-4 text-xl font-bold leading-snug">{featured.title}</h2>
              <p className="mt-1 text-[13px] text-primary-foreground/80">
                {featured.duration_minutes} phút
                {featured.subject ? ` · ${featured.subject}` : ""}
              </p>
              <div className="mt-6 w-full rounded-xl bg-white py-3 text-center text-[15px] font-bold text-primary shadow-lg">
                Bắt đầu thi ngay
              </div>
            </div>
            <div className="pointer-events-none absolute -right-8 -bottom-8 size-32 rounded-full bg-white/10 blur-2xl" />
            <div className="pointer-events-none absolute -left-4 -top-4 size-24 rounded-full bg-white/10 blur-xl" />
          </Link>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Đang mở
            </p>
            <p className="mt-1 text-2xl font-bold">{openExams.length}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Sắp mở
            </p>
            <p className="mt-1 text-2xl font-bold">{scheduledExams.length}</p>
          </div>
        </div>

        <section className="mt-8">
          <h2 className="text-[17px] font-semibold">Danh sách bài kiểm tra</h2>
          <div className="mt-4 space-y-3">
            {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
            {!isLoading && (exams?.length ?? 0) === 0 && (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Chưa có bài kiểm tra nào.
              </div>
            )}
            {rest.map((exam) => {
              const status = examStatus(exam);
              return (
                <Link
                  key={exam.id}
                  to="/thi/$examId"
                  params={{ examId: exam.id }}
                  className="block rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
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
                  <p className="mt-3 text-[12px] text-muted-foreground tabular">
                    Mở: {formatDateTime(exam.open_at)} · Đóng: {formatDateTime(exam.close_at)}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>

        <div className="relative mt-10 flex items-center py-2">
          <div className="flex-grow border-t border-border" />
          <span className="flex-shrink-0 px-4 text-[11px] uppercase tracking-wider text-muted-foreground">
            Khu vực giáo viên
          </span>
          <div className="flex-grow border-t border-border" />
        </div>

        <Link
          to="/auth"
          className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/30"
        >
          <div>
            <p className="font-display text-[15px] font-semibold">Đăng nhập giáo viên</p>
            <p className="text-[12px] text-muted-foreground">Quản lý đề thi và xem kết quả</p>
          </div>
          <span className="text-[18px] text-muted-foreground">→</span>
        </Link>
      </main>
    </div>
  );
}

export function StatusChip({ status }: { status: "open" | "closed" | "scheduled" }) {
  const styles =
    status === "open"
      ? "bg-primary/10 text-primary"
      : status === "scheduled"
        ? "bg-accent/40 text-accent-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles}`}>
      {statusLabel[status]}
    </span>
  );
}
