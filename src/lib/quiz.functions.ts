import { createServerFn } from "@tanstack/react-start";

export type PublicQuestion = {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  points: number;
};

/** Lấy danh sách câu hỏi cho học sinh — không kèm đáp án đúng. */
export const getExamQuestions = createServerFn({ method: "GET" })
  .inputValidator((data: { examId: string }) => {
    if (!data || typeof data.examId !== "string") throw new Error("examId is required");
    return { examId: data.examId };
  })
  .handler(async ({ data }): Promise<PublicQuestion[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("exam_questions")
      .select("id, position, prompt, options, points")
      .eq("exam_id", data.examId)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      position: r.position,
      prompt: r.prompt,
      options: Array.isArray(r.options) ? (r.options as unknown[]).map(String) : [],
      points: Number(r.points),
    }));
  });

/** Chấm bài tự động và lưu điểm cho lượt làm bài. */
export const gradeAttempt = createServerFn({ method: "POST" })
  .inputValidator((data: { examId: string; attemptId: string; answers: Record<string, number> }) => {
    if (!data || typeof data.examId !== "string" || typeof data.attemptId !== "string") {
      throw new Error("examId and attemptId are required");
    }
    return {
      examId: data.examId,
      attemptId: data.attemptId,
      answers: (data.answers ?? {}) as Record<string, number>,
    };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("exam_questions")
      .select("id, correct_index, points")
      .eq("exam_id", data.examId);
    if (error) throw new Error(error.message);

    let earned = 0;
    let total = 0;
    let correctCount = 0;
    for (const q of rows ?? []) {
      const pts = Number(q.points) || 0;
      total += pts;
      if (data.answers[q.id] === q.correct_index) {
        earned += pts;
        correctCount += 1;
      }
    }
    const score = total > 0 ? Math.round((earned / total) * 1000) / 100 : 0; // thang điểm 10

    const { error: upErr } = await supabaseAdmin
      .from("exam_attempts")
      .update({
        submitted_at: new Date().toISOString(),
        score,
        answers: data.answers,
      })
      .eq("id", data.attemptId);
    if (upErr) throw new Error(upErr.message);

    return { score, earned, total, correctCount, questionCount: (rows ?? []).length };
  });

/** Kiểm tra một họ tên đã làm bài này chưa (mỗi học sinh chỉ thi 1 lần). */
export const checkStudentName = createServerFn({ method: "POST" })
  .inputValidator((data: { examId: string; name: string }) => {
    if (!data || typeof data.examId !== "string") throw new Error("examId is required");
    return { examId: data.examId, name: String(data.name ?? "") };
  })
  .handler(async ({ data }): Promise<{ taken: boolean }> => {
    const name = data.name.trim().replace(/\s+/g, " ");
    if (!name) return { taken: false };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, student_name")
      .eq("exam_id", data.examId);
    if (error) throw new Error(error.message);
    const target = name.toLowerCase();
    const taken = (rows ?? []).some(
      (r) => String(r.student_name ?? "").trim().replace(/\s+/g, " ").toLowerCase() === target,
    );
    return { taken };
  });

export type PublicExamInfo = {
  id: string;
  title: string;
  subject: string | null;
  mode: string;
  duration_minutes: number;
  open_at: string | null;
  close_at: string | null;
  registration_open: boolean;
  created_at: string;
  updated_at: string;
};

/** Thông tin an toàn của một bài thi ĐÃ ĐÓNG — không kèm link form hay mã giáo viên. */
export const getPublicExamInfo = createServerFn({ method: "GET" })
  .inputValidator((data: { examId: string }) => {
    if (!data || typeof data.examId !== "string") throw new Error("examId is required");
    return { examId: data.examId };
  })
  .handler(async ({ data }): Promise<PublicExamInfo | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: exam, error } = await supabaseAdmin
      .from("exams")
      .select("id, title, subject, mode, duration_minutes, open_at, close_at, registration_open, created_at, updated_at")
      .eq("id", data.examId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!exam) return null;
    const closed =
      !exam.registration_open ||
      (exam.close_at !== null && new Date(exam.close_at).getTime() <= Date.now());
    if (!closed) return null;
    return exam as PublicExamInfo;
  });

export type StudentResult = {
  attemptId: string;
  studentName: string;
  studentClass: string | null;
  score: number | null;
  submittedAt: string;
};

/** Học sinh tra cứu kết quả của chính mình sau khi bài thi đã đóng. */
export const getStudentResult = createServerFn({ method: "POST" })
  .inputValidator((data: { examId: string; name: string }) => {
    if (!data || typeof data.examId !== "string") throw new Error("examId is required");
    return { examId: data.examId, name: String(data.name ?? "") };
  })
  .handler(async ({ data }): Promise<StudentResult | null> => {
    const name = data.name.trim().replace(/\s+/g, " ").toLowerCase();
    if (!name) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: exam, error: examErr } = await supabaseAdmin
      .from("exams")
      .select("id, registration_open, close_at")
      .eq("id", data.examId)
      .maybeSingle();
    if (examErr) throw new Error(examErr.message);
    if (!exam) return null;
    const closed =
      !exam.registration_open ||
      (exam.close_at !== null && new Date(exam.close_at).getTime() <= Date.now());
    if (!closed) throw new Error("Kết quả chỉ được công bố sau khi bài thi đóng.");

    const { data: rows, error } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, student_name, student_class, score, submitted_at")
      .eq("exam_id", data.examId)
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false });
    if (error) throw new Error(error.message);

    const found = (rows ?? []).find(
      (r) => String(r.student_name ?? "").trim().replace(/\s+/g, " ").toLowerCase() === name,
    );
    if (!found) return null;
    return {
      attemptId: found.id,
      studentName: found.student_name,
      studentClass: found.student_class,
      score: found.score,
      submittedAt: found.submitted_at!,
    };
  });

export type ReviewQuestion = {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  points: number;
  correctIndex: number;
  chosenIndex: number | null;
};

/** Cho học sinh xem lại bài đã nộp: câu hỏi, đáp án đã chọn và đáp án đúng. */
export const getAttemptReview = createServerFn({ method: "POST" })
  .inputValidator((data: { examId: string; attemptId: string }) => {
    if (!data || typeof data.examId !== "string" || typeof data.attemptId !== "string") {
      throw new Error("examId and attemptId are required");
    }
    return { examId: data.examId, attemptId: data.attemptId };
  })
  .handler(async ({ data }): Promise<ReviewQuestion[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: attempt }, { data: rows, error }] = await Promise.all([
      supabaseAdmin
        .from("exam_attempts")
        .select("id, answers, submitted_at")
        .eq("id", data.attemptId)
        .maybeSingle(),
      supabaseAdmin
        .from("exam_questions")
        .select("id, position, prompt, options, points, correct_index")
        .eq("exam_id", data.examId)
        .order("position", { ascending: true }),
    ]);
    if (error) throw new Error(error.message);
    if (!attempt?.submitted_at) return [];
    const answers = (attempt.answers ?? {}) as Record<string, number>;
    return (rows ?? []).map((r) => ({
      id: r.id,
      position: r.position,
      prompt: r.prompt,
      options: Array.isArray(r.options) ? (r.options as unknown[]).map(String) : [],
      points: Number(r.points),
      correctIndex: r.correct_index,
      chosenIndex: typeof answers[r.id] === "number" ? answers[r.id]! : null,
    }));
  });

/** Chấm thử cho chế độ xem trước của giáo viên — không lưu vào cơ sở dữ liệu. */
export const gradePreview = createServerFn({ method: "POST" })
  .inputValidator((data: { examId: string; answers: Record<string, number> }) => {
    if (!data || typeof data.examId !== "string") throw new Error("examId is required");
    return { examId: data.examId, answers: (data.answers ?? {}) as Record<string, number> };
  })
  .handler(async ({ data }): Promise<{ score: number; review: ReviewQuestion[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("exam_questions")
      .select("id, position, prompt, options, points, correct_index")
      .eq("exam_id", data.examId)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);

    let earned = 0;
    let total = 0;
    for (const q of rows ?? []) {
      const pts = Number(q.points) || 0;
      total += pts;
      if (data.answers[q.id] === q.correct_index) earned += pts;
    }
    const score = total > 0 ? Math.round((earned / total) * 1000) / 100 : 0;

    return {
      score,
      review: (rows ?? []).map((r) => ({
        id: r.id,
        position: r.position,
        prompt: r.prompt,
        options: Array.isArray(r.options) ? (r.options as unknown[]).map(String) : [],
        points: Number(r.points),
        correctIndex: r.correct_index,
        chosenIndex: typeof data.answers[r.id] === "number" ? data.answers[r.id]! : null,
      })),
    };
  });
