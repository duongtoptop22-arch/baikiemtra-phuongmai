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
