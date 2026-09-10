import { createServerFn } from "@tanstack/react-start";

/** Tạo lượt làm bài cho học sinh (chạy phía máy chủ, không phụ thuộc quyền truy cập của khách). */
export const createAttempt = createServerFn({ method: "POST" })
  .inputValidator((data: { examId: string; name: string; klass: string; startedAt: string }) => {
    if (!data || typeof data.examId !== "string") throw new Error("examId is required");
    return {
      examId: data.examId,
      name: String(data.name ?? "").trim(),
      klass: String(data.klass ?? "").trim(),
      startedAt: data.startedAt || new Date().toISOString(),
    };
  })
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("exam_attempts")
      .insert({
        exam_id: data.examId,
        student_name: data.name,
        student_class: data.klass,
        started_at: data.startedAt,
      })
      .select("id")
      .maybeSingle();
    if (error || !row?.id) throw new Error(error?.message ?? "Không tạo được lượt thi");
    return { id: row.id };
  });

/** Cập nhật lượt làm bài: số lần rời tab và thời điểm nộp. */
export const updateAttempt = createServerFn({ method: "POST" })
  .inputValidator((data: { attemptId: string; tabSwitches?: number; submittedAt?: string | null }) => {
    if (!data || typeof data.attemptId !== "string") throw new Error("attemptId is required");
    return {
      attemptId: data.attemptId,
      tabSwitches: typeof data.tabSwitches === "number" ? data.tabSwitches : undefined,
      submittedAt: data.submittedAt ?? undefined,
    };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: { tab_switches?: number; submitted_at?: string } = {};
    if (typeof data.tabSwitches === "number") patch.tab_switches = data.tabSwitches;
    if (data.submittedAt) patch.submitted_at = data.submittedAt;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("exam_attempts").update(patch).eq("id", data.attemptId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
