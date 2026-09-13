import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  checkStudentName,
  getAttemptReview,
  getExamQuestions,
  getPublicExamInfo,
  getStudentResult,
  gradeAttempt,
  gradePreview,
  type PublicQuestion,
  type ReviewQuestion,
  type StudentResult,
} from "@/lib/quiz.functions";
import { createAttempt, updateAttempt } from "@/lib/attempt.functions";
import {
  deadlineFor,
  examStatus,
  formatClock,
  formatDateTime,
  saveCompletedExam,
  secondsToClose,
  startKey,
  toEmbedUrl,
  type Exam,
} from "@/lib/exam";

export const Route = createFileRoute("/thi/$examId")({
  validateSearch: (search: Record<string, unknown>): { test?: 1 } =>
    search['test'] === 1 || search['test'] === "1" ? { test: 1 } : {},
  head: () => ({
    meta: [
      { title: "Làm bài kiểm tra — Phòng thi trực tuyến" },
      {
        name: "description",
        content: "Làm bài kiểm tra Google Form với đồng hồ đếm ngược, tự đóng khi hết giờ.",
      },
      { property: "og:title", content: "Làm bài kiểm tra" },
      { property: "og:description", content: "Bài kiểm tra có đồng hồ đếm ngược." },
    ],
  }),
  component: ExamPage,
});

function ExamPage() {
  const { examId } = Route.useParams();
  const { test } = Route.useSearch();
  const { data: exam, isLoading } = useQuery({
    queryKey: ["exam", examId],
    queryFn: async () => {
      const { data, error } = await supabase.from("exams").select("*").eq("id", examId).maybeSingle();
      if (error) throw error;
      if (data) return data as Exam;
      // Bài đã đóng không còn hiển thị công khai — lấy thông tin an toàn qua máy chủ.
      const info = await getPublicExamInfo({ data: { examId } });
      if (!info) return null;
      return { ...info, teacher_id: "", form_url: "" } as Exam;
    },
  });

  if (isLoading) {
    return <Centered>Đang tải…</Centered>;
  }
  if (!exam) {
    return <Centered>Không tìm thấy bài kiểm tra này.</Centered>;
  }
  return <ExamRunner exam={exam} testMode={test === 1} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="paper grid min-h-screen place-items-center px-5 text-center">
      <div>
        <p className="text-sm text-muted-foreground">{children}</p>
        <Link to="/" className="mt-4 inline-block text-sm font-semibold text-primary">
          ← Về trang chủ
        </Link>
      </div>
    </div>
  );
}

/** Ngưỡng cảnh báo chuyển tab (chỉ ghi nhận, không buộc nộp bài). */
const WARN_TAB_SWITCHES = 3;

type Persisted = {
  at: number;
  attemptId?: string | null;
  submitted?: boolean;
  tabSwitches?: number;
};

function ExamRunner({ exam, testMode }: { exam: Exam; testMode: boolean }) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [name, setName] = useState("");
  const [klass, setKlass] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [tabSwitches, setTabSwitches] = useState(0);
  const [endReason, setEndReason] = useState<"time" | "manual" | null>(null);
  // Thời gian còn lại được "đóng băng" khi nộp bài — đồng hồ ngừng chạy.
  const [frozenRemaining, setFrozenRemaining] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [score, setScore] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState<ReviewQuestion[] | null>(null);
  const [showReview, setShowReview] = useState(false);

  const isManual = exam.mode === "manual";
  const fetchQuestions = useServerFn(getExamQuestions);
  const grade = useServerFn(gradeAttempt);
  const gradeTest = useServerFn(gradePreview);
  const checkName = useServerFn(checkStudentName);
  const fetchReview = useServerFn(getAttemptReview);
  const newAttempt = useServerFn(createAttempt);
  const saveAttempt = useServerFn(updateAttempt);
  const { data: questions } = useQuery({
    queryKey: ["exam-questions", exam.id],
    queryFn: () => fetchQuestions({ data: { examId: exam.id } }) as Promise<PublicQuestion[]>,
    enabled: isManual,
  });

  const answersRef = useRef(answers);
  answersRef.current = answers;


  // Refs giữ giá trị mới nhất cho các listener (tránh stale closure).
  const ref = useRef({
    startedAt,
    attemptId,
    submitted,
    tabSwitches,
    testMode,
  });
  ref.current = { startedAt, attemptId, submitted, tabSwitches, testMode };

  const persist = (at: number, id: string | null, done: boolean, switches: number) => {
    localStorage.setItem(
      startKey(exam.id),
      JSON.stringify({ at, attemptId: id, submitted: done, tabSwitches: switches } satisfies Persisted),
    );
  };

  useEffect(() => {
    if (testMode) return;
    const saved = localStorage.getItem(startKey(exam.id));
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Persisted;
        setStartedAt(parsed.at);
        setAttemptId(parsed.attemptId ?? null);
        setSubmitted(Boolean(parsed.submitted));
        setTabSwitches(parsed.tabSwitches ?? 0);
      } catch {
        setStartedAt(Number(saved));
      }
    }
  }, [exam.id, testMode]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const status = examStatus(exam, new Date(now));
  const gated = status !== "open" && !testMode;
  const secondsToOpen = exam.open_at ? (new Date(exam.open_at).getTime() - now) / 1000 : 0;



  const deadline = startedAt ? deadlineFor(exam, startedAt) : null;
  const liveRemaining = deadline ? (deadline - now) / 1000 : exam.duration_minutes * 60;
  // Khi đã nộp, đồng hồ dừng lại ở mốc lúc bấm nộp.
  const remaining = frozenRemaining ?? liveRemaining;
  const timeUp = deadline !== null && liveRemaining <= 0 && !testMode && frozenRemaining === null;
  const urgent = remaining <= 300;

  // Kết thúc bài: hết giờ hoặc học sinh tự bấm nộp.
  const finish = async (reason: "time" | "manual") => {
    if (ref.current.submitted) return;
    setSubmitted(true);
    setFrozenRemaining(reason === "time" ? 0 : Math.max(0, liveRemaining));
    setEndReason(reason);
    const cur = ref.current;
    if (testMode) {
      // Xem thử của giáo viên: vẫn chấm và cho xem lại, nhưng không lưu.
      if (isManual) {
        try {
          const res = await gradeTest({ data: { examId: exam.id, answers: answersRef.current } });
          setScore(res.score);
          setReview(res.review);
        } catch {
          /* bỏ qua */
        }
      }
      return;
    }
    if (!cur.startedAt) return;
    persist(cur.startedAt, cur.attemptId, true, cur.tabSwitches);
    // Ghi nhớ bài đã làm trên máy học sinh để tra cứu lại ở trang chủ.
    const record = (finalScore: number | null) =>
      saveCompletedExam({
        examId: exam.id,
        title: exam.title,
        subject: exam.subject,
        studentName: name.trim(),
        studentClass: klass.trim() || null,
        score: finalScore,
        submittedAt: new Date().toISOString(),
      });
    if (cur.attemptId) {
      try {
        await saveAttempt({
          data: {
            attemptId: cur.attemptId,
            submittedAt: new Date().toISOString(),
            tabSwitches: cur.tabSwitches,
          },
        });
      } catch {
        setSaveError("Không lưu được bài làm lên hệ thống. Báo ngay cho giáo viên.");
      }

      if (isManual) {
        try {
          const res = await grade({
            data: { examId: exam.id, attemptId: cur.attemptId, answers: answersRef.current },
          });
          setScore(res.score);
          record(res.score);
        } catch {
          record(null);
          setSaveError("Không chấm được bài. Báo ngay cho giáo viên.");
        }
      } else {
        record(null);
      }
    } else {
      setSaveError("Bài làm chưa được ghi nhận vì lượt thi không tạo được. Báo ngay cho giáo viên.");
    }
  };

  // Ref cho finish để listener gọi được.
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Tự nộp khi hết giờ.
  useEffect(() => {
    if (timeUp && !submitted && !testMode && startedAt) {
      finishRef.current("time");
    }
  }, [timeUp, submitted, testMode, startedAt]);

  // Ghi nhận rời khỏi trang thi (chỉ đếm, không buộc nộp bài).
  useEffect(() => {
    if (testMode || !startedAt || submitted) return;

    let lastAt = 0;
    const onVisibility = () => {
      // Chỉ tính khi tab thực sự bị ẩn, và bỏ qua các lần lặp trong 2 giây.
      if (!document.hidden) return;
      const t = Date.now();
      if (t - lastAt < 2000) return;
      lastAt = t;

      const cur = ref.current;
      if (cur.testMode || cur.submitted || !cur.startedAt) return;
      const next = cur.tabSwitches + 1;
      setTabSwitches(next);
      persist(cur.startedAt, cur.attemptId, false, next);
      if (cur.attemptId) {
        void saveAttempt({ data: { attemptId: cur.attemptId, tabSwitches: next } }).catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, submitted, testMode, exam.id]);

  const start = async () => {
    if (!testMode && (!name.trim() || !klass.trim())) {
      setFormError("Nhập họ tên và lớp trước khi bắt đầu.");
      return;
    }
    setFormError(null);
    if (!testMode) {
      setChecking(true);
      try {
        const res = await checkName({ data: { examId: exam.id, name: name.trim() } });
        if (res.taken) {
          setFormError("Họ tên này đã làm bài kiểm tra rồi. Mỗi học sinh chỉ được thi một lần.");
          return;
        }
      } catch {
        /* nếu không kiểm tra được thì vẫn cho làm bài */
      } finally {
        setChecking(false);
      }
    }
    const ts = Date.now();
    if (testMode) {
      setStartedAt(ts);
      setTabSwitches(0);
      return;
    }
    // Tạo lượt thi trước — nếu không lưu được thì không cho bắt đầu.
    let attempt: { id: string };
    try {
      attempt = await newAttempt({
        data: {
          examId: exam.id,
          name: name.trim(),
          klass: klass.trim(),
          startedAt: new Date(ts).toISOString(),
        },
      });
    } catch (e) {
      setFormError(
        `Không kết nối được để lưu bài thi${e instanceof Error && e.message ? ` (${e.message})` : ""}. Kiểm tra mạng rồi thử lại.`,
      );
      return;
    }
    setStartedAt(ts);
    setTabSwitches(0);
    setAttemptId(attempt.id);
    persist(ts, attempt.id, false, 0);
  };

  // Xoá lượt thi đã lưu trên máy này để học sinh kế tiếp làm bài với tên riêng.
  const resetForNextStudent = () => {
    localStorage.removeItem(startKey(exam.id));
    setStartedAt(null);
    setAttemptId(null);
    setSubmitted(false);
    setEndReason(null);
    setFrozenRemaining(null);
    setAnswers({});
    setScore(null);
    setTabSwitches(0);
    setName("");
    setKlass("");
    setFormError(null);
    setReview(null);
    setShowReview(false);
    setSaveError(null);
  };

  const openReview = async () => {
    setShowReview(true);
    if (review || !attemptId || testMode) return;
    // Chỉ tải đáp án khi bài thi đã đóng; khi còn mở thì giao diện hiện thông báo đếm ngược.
    if (examStatus(exam, new Date()) !== "closed") return;
    try {
      const rows = (await fetchReview({
        data: { examId: exam.id, attemptId },
      })) as ReviewQuestion[];
      setReview(rows);
    } catch {
      setReview([]);
    }
  };

  const field =
    "w-full rounded-xl border border-input bg-secondary px-4 py-3 text-[14px] text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";

  const tabWarning = tabSwitches > 0 && !submitted && startedAt;
  const tabDanger = tabSwitches >= WARN_TAB_SWITCHES;

  // Chưa tới giờ / đã đóng: hiện bảng đếm ngược theo thời gian thực.
  if (gated) {
    const finalCountdown = status === "scheduled" && secondsToOpen <= 10;
    return (
      <div className="paper grid min-h-screen place-items-center px-5 text-center">
        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-[22px] font-bold leading-tight text-balance">{exam.title}</h1>
          {exam.subject && <p className="mt-1 text-[13px] text-muted-foreground">{exam.subject}</p>}

          {status === "scheduled" ? (
            <>
              <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {finalCountdown ? "Sắp bắt đầu" : "Mở sau"}
              </p>
              <p
                className={`mt-2 font-display leading-none tabular ${
                  finalCountdown
                    ? "animate-pulse text-[72px] text-primary"
                    : "text-[48px] text-foreground"
                }`}
              >
                {formatClock(Math.max(0, secondsToOpen))}
              </p>
              <p className="mt-4 text-[13px] text-muted-foreground">
                Mở lúc {formatDateTime(exam.open_at)} — trang sẽ tự chuyển sang bài kiểm tra.
              </p>
            </>
          ) : (
            <ClosedResult exam={exam} />
          )}

          <Link to="/" className="mt-6 inline-block text-sm font-semibold text-primary">
            ← Về trang chủ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="paper min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3">
          <Link to="/" className="text-[13px] font-medium text-muted-foreground hover:text-foreground">
            ← Danh sách
          </Link>
          {startedAt ? (
            <span
              className={`rounded-full px-3.5 py-1.5 font-display text-[16px] font-semibold tabular ${
                timeUp || submitted
                  ? "bg-secondary text-muted-foreground"
                  : urgent
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 text-primary"
              }`}
            >
              {formatClock(Math.max(0, remaining))}
            </span>
          ) : (
            <span className="text-[12px] font-medium text-muted-foreground">{exam.duration_minutes} phút</span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-16">
        {testMode && (
          <p className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-[12px] font-medium text-primary">
            Chế độ xem thử của giáo viên — bài làm không được lưu.
          </p>
        )}

        <h1 className="text-[26px] font-bold leading-tight text-balance">{exam.title}</h1>
        {exam.subject && <p className="mt-1 text-[14px] text-muted-foreground">{exam.subject}</p>}

        <div
          className={`mt-6 rounded-3xl border p-6 text-center shadow-sm ${
            timeUp
              ? "border-destructive/20 bg-destructive/5"
              : urgent && startedAt
                ? "border-destructive/20 bg-card"
                : "border-border bg-card"
          }`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {timeUp ? "Đã hết giờ" : startedAt ? "Thời gian còn lại" : "Thời lượng"}
          </p>
          <p
            className={`mt-2 font-display text-[52px] leading-none tabular ${
              timeUp || (urgent && startedAt) ? "text-destructive" : "text-foreground"
            }`}
          >
            {formatClock(Math.max(0, remaining))}
          </p>

          {!startedAt && !testMode && (
              <div className="mt-5 text-left">
                <label className="block">
                  <span className="text-[13px] font-medium text-muted-foreground">Họ và tên</span>
                  <input
                    className={`${field} mt-1.5`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="DANG NGOC DUONG"
                  />
                </label>
                <label className="mt-3 block">
                  <span className="text-[13px] font-medium text-muted-foreground">Lớp</span>
                  <input
                    className={`${field} mt-1.5 placeholder:text-muted-foreground/60`}
                    value={klass}
                    onChange={(e) => setKlass(e.target.value)}
                    placeholder="K19B SPAN"
                  />
                </label>
                {formError && <p className="mt-2 text-[12px] text-destructive">{formError}</p>}

                <div className="mt-4 rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-destructive">
                    LƯU Ý
                  </p>
                  <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-muted-foreground">
                    <li>• Nhập đúng họ tên và lớp của bạn để hệ thống tự động duyệt mở bài thi — bài làm sẽ gắn với tên này.</li>
                    <li>• Hệ thống ghi lại mọi lần bạn rời khỏi trang thi và báo cho giáo viên.</li>
                    <li>• Không mở tab khác, không tra cứu tài liệu, không trao đổi bài.</li>
                    <li>• Hết giờ bài sẽ tự dừng. Vi phạm có thể bị huỷ kết quả.</li>
                </ul>
              </div>
            </div>
          )}

          {!startedAt && (
            <button
              onClick={start}
              className="mt-5 w-full rounded-xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Bắt đầu làm bài
            </button>
          )}
          {startedAt && !timeUp && !submitted && (
            <p className="mt-3 text-[12px] text-muted-foreground">
              {isManual
                ? "Chọn đáp án cho từng câu rồi bấm “Nộp bài”. Đừng chuyển tab — hệ thống sẽ ghi nhận."
                : "Nhớ bấm “Gửi” trong biểu mẫu trước khi hết giờ. Đừng chuyển tab — hệ thống sẽ ghi nhận."}
            </p>
          )}
        </div>

        {tabWarning && !submitted && (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-[13px] font-medium ${
              tabDanger
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-amber-300/40 bg-amber-50 text-amber-700"
            }`}
          >
            ⚠ Đã rời khỏi trang {tabSwitches} lần. Hệ thống đã ghi nhận — bạn vẫn làm bài tiếp, nhưng số lần rời tab sẽ được báo cho giáo viên.
          </div>
        )}

        {startedAt && !timeUp && !submitted && !isManual && (
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <iframe
              src={toEmbedUrl(exam.form_url)}
              title={exam.title}
              className="h-[70vh] w-full"
              loading="lazy"
            />
          </div>
        )}

        {startedAt && !timeUp && !submitted && isManual && (
          <div className="mt-4 space-y-3">
            {(questions ?? []).length === 0 && (
              <p className="rounded-2xl border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
                Giáo viên chưa nhập câu hỏi cho bài này.
              </p>
            )}
            {(questions ?? []).map((q, i) => (
              <div key={q.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <p className="text-[12px] font-semibold text-muted-foreground">
                  Câu {i + 1} · {q.points} điểm
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[15px] font-medium">{q.prompt}</p>
                <div className="mt-3 space-y-2">
                  {q.options.map((opt, oi) => (
                    <label
                      key={oi}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-[14px] transition-colors ${
                        answers[q.id] === oi
                          ? "border-primary bg-primary/5"
                          : "border-border bg-secondary"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        className="size-4 accent-primary"
                        checked={answers[q.id] === oi}
                        onChange={() => setAnswers({ ...answers, [q.id]: oi })}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {startedAt && !timeUp && !submitted && (
          <button
            onClick={() => finish("manual")}
            className="mt-4 w-full rounded-xl border border-primary bg-card py-3.5 text-[15px] font-semibold text-primary transition-colors hover:bg-primary/5"
          >
            {isManual ? "Nộp bài" : "Đã nộp bài"}
          </button>
        )}

        {submitted && (
          <div className="mt-4 rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
            <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-primary/10">
              <span className="text-[24px]">✓</span>
            </div>
            <p className="font-display text-[20px] font-bold">
              {endReason === "time" ? "Đã hết giờ" : "Đã ghi nhận bài làm"}
            </p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              {endReason === "time"
                ? "Hết thời gian làm bài — hệ thống đã tự động nộp."
                : "Bài làm của bạn đã được lưu."}
            </p>
            {isManual && score !== null && (
              <div className="mt-4 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Điểm của bạn
                </p>
                <p className="mt-1 font-display text-[40px] font-bold leading-none tabular text-primary">
                  {score}
                  <span className="text-[18px] text-muted-foreground">/10</span>
                </p>
              </div>
            )}
            {tabSwitches > 0 && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Số lần chuyển tab: {tabSwitches}
              </p>
            )}
            <p className="mt-3 text-[12px] text-muted-foreground">
              Đồng hồ đã dừng ở {formatClock(Math.max(0, remaining))}.
            </p>
            {saveError && (
              <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] font-medium text-destructive">
                {saveError}
              </p>
            )}
            {isManual && (attemptId || testMode) && (
              <button
                onClick={() => (showReview ? setShowReview(false) : openReview())}
                className="mt-4 w-full rounded-xl bg-primary py-3 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {showReview ? "Ẩn bài làm" : "Xem lại bài thi của tôi"}
              </button>
            )}
{showReview && (
  <div className="mt-4 space-y-3 text-left">
    {!testMode && examStatus(exam, new Date(now)) !== "closed" ? (
      <div className="rounded-2xl border border-primary/25 bg-primary/5 p-5 text-center">
        <p className="text-[13px] font-medium text-primary">
          Kết quả bài thi và đáp án sẽ được công bố sau
        </p>
        {secondsToClose(exam, new Date(now)) !== null ? (
          <>
            <p className="mt-2 font-display text-[40px] font-bold leading-none tabular text-primary">
              {formatClock(Math.ceil(secondsToClose(exam, new Date(now))!))}
            </p>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Đóng lúc {formatDateTime(exam.close_at)}
            </p>
          </>
        ) : (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Sau khi giáo viên đóng bài thi.
          </p>
        )}
      </div>
    ) : (
      <ReviewList review={review} />
    )}
  </div>
)}
            <button
              onClick={resetForNextStudent}
              className="mt-4 w-full rounded-xl border border-primary bg-card py-3 text-[14px] font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              Học sinh khác làm bài trên máy này
            </button>
            <Link to="/" className="mt-4 inline-block text-sm font-semibold text-primary">
              Về trang chủ
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

/** Danh sách câu hỏi kèm đáp án đúng và lựa chọn của học sinh. */
function ReviewList({ review }: { review: ReviewQuestion[] | null }) {
  return (
    <>
      {review === null && (
        <p className="text-[13px] text-muted-foreground">Đang tải bài làm…</p>
      )}
      {review?.length === 0 && (
        <p className="text-[13px] text-muted-foreground">Không có dữ liệu bài làm.</p>
      )}
      {(review ?? []).map((q, i) => (
        <div key={q.id} className="rounded-2xl border border-border bg-secondary/40 p-4">
          <p className="text-[12px] font-semibold text-muted-foreground">
            Câu {i + 1} · {q.points} điểm ·{" "}
            {q.chosenIndex === q.correctIndex ? "Đúng" : "Sai"}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[14px] font-medium">{q.prompt}</p>
          <div className="mt-2 space-y-1.5">
            {q.options.map((opt, oi) => {
              const isCorrect = oi === q.correctIndex;
              const isChosen = oi === q.chosenIndex;
              return (
                <p
                  key={oi}
                  className={`rounded-xl border px-3 py-2 text-[13px] ${
                    isCorrect
                      ? "border-primary bg-primary/10 font-medium"
                      : isChosen
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-border bg-card"
                  }`}
                >
                  {opt}
                  {isCorrect && " ✓"}
                  {isChosen && !isCorrect && " ← bạn chọn"}
                </p>
              );
            })}
            {q.chosenIndex === null && (
              <p className="text-[12px] text-muted-foreground">Bạn chưa trả lời câu này.</p>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

/** Tra cứu kết quả sau khi bài thi đã đóng: nhập đúng họ tên đã thi để xem điểm và bài làm. */
function ClosedResult({ exam }: { exam: Exam }) {
  const fetchResult = useServerFn(getStudentResult);
  const fetchReview = useServerFn(getAttemptReview);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StudentResult | null>(null);
  const [review, setReview] = useState<ReviewQuestion[] | null>(null);
  const [showReview, setShowReview] = useState(false);

  const lookup = async () => {
    if (!name.trim()) {
      setError("Nhập họ tên bạn đã dùng khi làm bài.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const found = await fetchResult({ data: { examId: exam.id, name: name.trim() } });
      if (!found) {
        setError("Không tìm thấy bài làm với họ tên này. Kiểm tra lại chính tả.");
        return;
      }
      setResult(found);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Không tra cứu được. Thử lại sau.");
    } finally {
      setLoading(false);
    }
  };

  const toggleReview = async () => {
    if (showReview) {
      setShowReview(false);
      return;
    }
    setShowReview(true);
    if (review || !result) return;
    try {
      const rows = (await fetchReview({
        data: { examId: exam.id, attemptId: result.attemptId },
      })) as ReviewQuestion[];
      setReview(rows);
    } catch {
      setReview([]);
    }
  };

  if (!result) {
    return (
      <div className="mt-6 text-left">
        <p className="text-center text-[14px] text-muted-foreground">
          Bài kiểm tra đã đóng. Nhập họ tên để xem điểm và bài làm của bạn.
        </p>
        <label className="mt-4 block">
          <span className="text-[13px] font-medium text-muted-foreground">Họ và tên</span>
          <input
            className="mt-1.5 w-full rounded-xl border border-input bg-secondary px-4 py-3 text-[14px] text-foreground outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void lookup();
            }}
            placeholder="DANG NGOC DUONG"
          />
        </label>
        {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
        <button
          onClick={() => void lookup()}
          disabled={loading}
          className="mt-4 w-full rounded-xl bg-primary py-3 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {loading ? "Đang tra cứu…" : "Tra cứu kết quả"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <p className="text-[13px] text-muted-foreground">
        {result.studentName}
        {result.studentClass ? ` · ${result.studentClass}` : ""}
      </p>
      {result.score !== null ? (
        <div className="mt-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Điểm của bạn
          </p>
          <p className="mt-1 font-display text-[40px] font-bold leading-none tabular text-primary">
            {result.score}
            <span className="text-[18px] text-muted-foreground">/10</span>
          </p>
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">
          Bài thi dạng biểu mẫu — điểm được giáo viên công bố riêng.
        </p>
      )}
      {exam.mode === "manual" && (
        <button
          onClick={() => void toggleReview()}
          className="mt-4 w-full rounded-xl bg-primary py-3 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {showReview ? "Ẩn bài làm" : "Xem lại bài thi của tôi"}
        </button>
      )}
      {showReview && (
        <div className="mt-4 space-y-3 text-left">
          <ReviewList review={review} />
        </div>
      )}
      <button
        onClick={() => {
          setResult(null);
          setReview(null);
          setShowReview(false);
          setName("");
        }}
        className="mt-4 w-full rounded-xl border border-border bg-card py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Tra cứu họ tên khác
      </button>
    </div>
  );
}
