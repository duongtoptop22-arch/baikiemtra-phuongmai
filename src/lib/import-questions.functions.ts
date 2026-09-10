import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DraftQuestion = {
  prompt: string;
  options: string[];
  correct_index: number;
  points: number;
};

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lấy nội dung câu hỏi từ một liên kết (Google Form công khai, trang web…). */
async function fetchSourceText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ExamImporter/1.0)" },
  });
  if (!res.ok) throw new Error(`Không tải được liên kết (${res.status}).`);
  const html = await res.text();
  // Google Form nhúng dữ liệu câu hỏi trong FB_PUBLIC_LOAD_DATA_
  const m = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*([\s\S]*?);\s*<\/script>/);
  if (m && m[1]) return m[1].slice(0, 60000);
  return htmlToText(html).slice(0, 60000);
}

type ExtractInput = {
  sourceUrl?: string | undefined;
  sourceText?: string | undefined;
};

async function askAi(raw: string): Promise<DraftQuestion[]> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("Thiếu cấu hình AI.");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "Bạn là trợ lý soạn đề trắc nghiệm. Đọc nội dung đề thi (có thể là dữ liệu thô của Google Form, PDF hoặc Word) và trích ra danh sách câu hỏi trắc nghiệm bằng tiếng Việt. Giữ nguyên văn câu hỏi và phương án. Nếu đề không ghi đáp án đúng, hãy tự suy luận đáp án đúng nhất. Nếu một câu không có phương án, hãy bỏ qua câu đó.",
        },
        {
          role: "user",
          content: `Trích các câu hỏi trắc nghiệm từ nội dung sau:\n\n${raw}`,
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "submit_questions",
            description: "Nộp danh sách câu hỏi đã trích",
            parameters: {
              type: "object",
              properties: {
                questions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      prompt: { type: "string" },
                      options: { type: "array", items: { type: "string" } },
                      correct_index: { type: "integer" },
                      points: { type: "number" },
                    },
                    required: ["prompt", "options", "correct_index"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["questions"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "submit_questions" } },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("Quá nhiều yêu cầu AI, thử lại sau ít phút.");
    if (res.status === 402) throw new Error("Hết hạn mức AI, cần nạp thêm.");
    throw new Error(`AI lỗi [${res.status}]: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
  };
  const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("AI không trả về câu hỏi.");

  let parsed: { questions?: DraftQuestion[] };
  try {
    parsed = JSON.parse(args) as { questions?: DraftQuestion[] };
  } catch {
    throw new Error("Không đọc được kết quả từ AI.");
  }

  return (parsed.questions ?? [])
    .map((q) => ({
      prompt: String(q.prompt ?? "").trim(),
      options: (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean),
      correct_index: Number.isFinite(q.correct_index) ? Number(q.correct_index) : 0,
      points: Number(q.points) > 0 ? Number(q.points) : 1,
    }))
    .filter((q) => q.prompt.length > 0 && q.options.length >= 2)
    .map((q) => ({ ...q, correct_index: Math.min(Math.max(q.correct_index, 0), q.options.length - 1) }));
}

/** Bước 1: AI đọc đề và trả về bản nháp câu hỏi để giáo viên xem trước, chưa lưu. */
export const extractQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ExtractInput) => {
    if (!data || (!data.sourceUrl && !data.sourceText)) throw new Error("Cần liên kết hoặc nội dung đề.");
    return {
      sourceUrl: (data.sourceUrl ?? "").trim(),
      sourceText: (data.sourceText ?? "").slice(0, 60000),
    };
  })
  .handler(async ({ data }): Promise<DraftQuestion[]> => {
    const raw = data.sourceText || (await fetchSourceText(data.sourceUrl));
    if (raw.trim().length < 20) throw new Error("Không đọc được nội dung đề từ nguồn này.");
    const questions = await askAi(raw);
    if (questions.length === 0) throw new Error("Không tìm thấy câu hỏi trắc nghiệm trong nguồn này.");
    return questions;
  });

/** Bước 2: lưu bản nháp (đã được giáo viên chỉnh sửa) vào bài kiểm tra. */
export const saveQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { examId: string; questions: DraftQuestion[]; replace?: boolean }) => {
    if (!data || typeof data.examId !== "string") throw new Error("examId is required");
    const questions = (Array.isArray(data.questions) ? data.questions : [])
      .map((q) => ({
        prompt: String(q.prompt ?? "").trim(),
        options: (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean),
        correct_index: Number.isFinite(q.correct_index) ? Number(q.correct_index) : 0,
        points: Number(q.points) > 0 ? Number(q.points) : 1,
      }))
      .filter((q) => q.prompt.length > 0 && q.options.length >= 2)
      .map((q) => ({ ...q, correct_index: Math.min(Math.max(q.correct_index, 0), q.options.length - 1) }));
    if (questions.length === 0) throw new Error("Chưa có câu hỏi hợp lệ để lưu.");
    return { examId: data.examId, questions, replace: Boolean(data.replace) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: exam, error: examErr } = await supabase
      .from("exams")
      .select("id, teacher_id")
      .eq("id", data.examId)
      .maybeSingle();
    if (examErr) throw new Error(examErr.message);
    if (!exam || exam.teacher_id !== userId) throw new Error("Không có quyền với bài kiểm tra này.");

    if (data.replace) {
      const { error: delErr } = await supabase.from("exam_questions").delete().eq("exam_id", data.examId);
      if (delErr) throw new Error(delErr.message);
    }

    const { count } = await supabase
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("exam_id", data.examId);
    const start = count ?? 0;

    const { error: insErr } = await supabase.from("exam_questions").insert(
      data.questions.map((q, i) => ({
        exam_id: data.examId,
        position: start + i,
        prompt: q.prompt,
        options: q.options,
        correct_index: q.correct_index,
        points: q.points,
      })),
    );
    if (insErr) throw new Error(insErr.message);

    return { imported: data.questions.length };
  });
