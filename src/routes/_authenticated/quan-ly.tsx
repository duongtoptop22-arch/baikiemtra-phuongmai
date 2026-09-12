import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  extractQuestions,
  saveQuestions,
  type DraftQuestion,
} from "@/lib/import-questions.functions";
import { getAttemptReview, type ReviewQuestion } from "@/lib/quiz.functions";
import { addAdmin, getMyRole, listAdmins, removeAdmin } from "@/lib/admin.functions";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  examStatus,
  formatDateTime,
  statusLabel,
  toEmbedUrl,
  type Exam,
} from "@/lib/exam";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit3,
  Eye,
  FileText,
  FileUp,
  GraduationCap,
  Link2,
  LogOut,
  Pause,
  Play,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Users,
  
  AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/quan-ly")({
  head: () => ({
    meta: [
      { title: "Quản lý bài kiểm tra — Phòng thi trực tuyến" },
      { name: "description", content: "Thêm và quản lý bài kiểm tra Google Form có hẹn giờ." },
      { property: "og:title", content: "Quản lý bài kiểm tra" },
      { property: "og:description", content: "Thêm bài kiểm tra, đặt thời lượng và giờ đóng." },
    ],
  }),
  component: Dashboard,
});

type Attempt = {
  id: string;
  student_name: string;
  student_class: string | null;
  started_at: string;
  submitted_at: string | null;
  tab_switches: number;
  score: number | null;
};

type Question = {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  correct_index: number;
  points: number;
};

const emptyForm = {
  title: "",
  subject: "",
  form_url: "",
  duration_minutes: "45",
  open_at: "",
  close_at: "",
  registration_open: true,
  mode: "form" as "form" | "manual",
};

const field =
  "mt-1.5 w-full rounded-xl border border-input bg-secondary px-4 py-3 text-[14px] text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";

function isFormUrl(url: string) {
  const v = url.trim();
  return /^https?:\/\/\S+$/.test(v);
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusBadgeVariant(status: ReturnType<typeof examStatus>) {
  switch (status) {
    case "open":
      return "default";
    case "scheduled":
      return "secondary";
    case "closed":
      return "outline";
    default:
      return "secondary";
  }
}

function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "live">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const createRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const url = form.form_url.trim();
    const t = setTimeout(() => setPreviewUrl(isFormUrl(url) ? url : ""), 700);
    return () => clearTimeout(t);
  }, [form.form_url]);

  const { data: myId } = useQuery({
    queryKey: ["my-uid"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: 60_000,
  });

  const { data: exams, isLoading } = useQuery({
    queryKey: ["my-exams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exams")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Exam[];
    },
    staleTime: 30_000,
  });

  const { data: stats } = useQuery({
    queryKey: ["teacher-stats"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Chưa đăng nhập");
      const { data: myExams } = await supabase.from("exams").select("id").eq("teacher_id", uid);
      const examIds = myExams?.map((e) => e.id) ?? [];
      let attemptsCount = 0;
      if (examIds.length > 0) {
        const { count } = await supabase
          .from("exam_attempts")
          .select("*", { count: "exact", head: true })
          .in("exam_id", examIds);
        attemptsCount = count ?? 0;
      }
      return { totalExams: myExams?.length ?? 0, attemptsCount };
    },
    staleTime: 30_000,
  });

  const live = useMemo(() => (exams ?? []).filter((e) => examStatus(e) === "open"), [exams]);
  const shown = tab === "live" ? live : (exams ?? []);

  const create = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Chưa đăng nhập");
      const { error } = await supabase.from("exams").insert({
        teacher_id: uid,
        title: form.title.trim(),
        subject: form.subject.trim() || null,
        form_url: form.form_url.trim(),
        duration_minutes: Number(form.duration_minutes) || 45,
        open_at: form.open_at ? new Date(form.open_at).toISOString() : null,
        close_at: form.close_at ? new Date(form.close_at).toISOString() : null,
        registration_open: form.registration_open,
        mode: form.mode,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm(emptyForm);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["my-exams"] });
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-stats"] });
    },
    onError: () => setError("Không lưu được. Kiểm tra lại thông tin."),
  });

  const toggle = useMutation({
    mutationFn: async (exam: Exam) => {
      const { error } = await supabase
        .from("exams")
        .update({ registration_open: !exam.registration_open })
        .eq("id", exam.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-exams"] });
      queryClient.invalidateQueries({ queryKey: ["exams"] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("exams").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setOpenId(null);
      queryClient.invalidateQueries({ queryKey: ["my-exams"] });
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-stats"] });
    },
  });

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || (form.mode === "form" && !form.form_url.trim())) {
      setError("Cần có tên bài và link Google Form.");
      return;
    }
    create.mutate();
  };

  const scrollToCreate = () => {
    createRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-background">
      <TopBar onSignOut={signOut} />

      <main className="mx-auto max-w-6xl px-4 py-6 pb-20">
        <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Quản lý bài kiểm tra</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tạo, theo dõi và điều chỉnh các bài kiểm tra cho lớp học của bạn.
            </p>
          </div>
          <Button onClick={scrollToCreate} className="gap-2 self-start sm:self-auto">
            <Plus className="size-4" />
            Tạo bài kiểm tra
          </Button>
        </section>

        <StatsGrid
          totalExams={stats?.totalExams ?? exams?.length ?? 0}
          liveExams={live.length}
          totalAttempts={stats?.attemptsCount ?? 0}
          isLoading={isLoading}
        />

        <div ref={createRef} className="mt-8">
          <CreateSection
            form={form}
            setForm={setForm}
            previewUrl={previewUrl}
            error={error}
            isPending={create.isPending}
            onSubmit={submit}
            onCreated={(id) => setOpenId(id)}
          />
        </div>

        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Danh sách bài kiểm tra</h2>
            <div className="flex gap-2">
              {(
                [
                  ["all", `Tất cả (${exams?.length ?? 0})`],
                  ["live", `Đang diễn ra (${live.length})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${
                    tab === key
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {isLoading && (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  Đang tải danh sách bài kiểm tra…
                </CardContent>
              </Card>
            )}
            {!isLoading && shown.length === 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="rounded-full bg-muted p-3">
                    <FileText className="size-6 text-muted-foreground" />
                  </div>
                  <p className="mt-4 font-medium">
                    {tab === "live"
                      ? "Không có bài kiểm tra nào đang diễn ra."
                      : "Bạn chưa tạo bài kiểm tra nào."}
                  </p>
                  <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                    {tab === "live"
                      ? "Các bài đang mở sẽ hiển thị ở đây."
                      : "Bắt đầu bằng cách tạo bài kiểm tra thủ công hoặc bằng AI ở trên."}
                  </p>
                  {tab === "all" && (
                    <Button variant="outline" onClick={scrollToCreate} className="mt-4 gap-2">
                      <Plus className="size-4" />
                      Tạo bài kiểm tra
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
            {shown.map((exam) => (
              <ExamCard
                key={exam.id}
                exam={exam}
                canManage={!myId || exam.teacher_id === myId}
                open={openId === exam.id}
                onToggleOpen={() => setOpenId(openId === exam.id ? null : exam.id)}
                onToggleStatus={() => toggle.mutate(exam)}
                onRemove={() => remove.mutate(exam.id)}
              />
            ))}
          </div>
        </section>

        <AdminPanel />
      </main>
    </div>
  );
}

function AdminPanel() {
  const queryClient = useQueryClient();
  const fetchRole = useServerFn(getMyRole);
  const fetchAdmins = useServerFn(listAdmins);
  const doAdd = useServerFn(addAdmin);
  const doRemove = useServerFn(removeAdmin);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const { data: me } = useQuery({ queryKey: ["my-role"], queryFn: () => fetchRole({}) });
  const isSuper = me?.role === "super_admin";

  const { data: admins, isLoading } = useQuery({
    queryKey: ["allowed-teachers"],
    queryFn: () => fetchAdmins({}),
    enabled: isSuper,
  });

  const add = useMutation({
    mutationFn: async () => doAdd({ data: { email } }),
    onSuccess: () => {
      setEmail("");
      setMsg(null);
      queryClient.invalidateQueries({ queryKey: ["allowed-teachers"] });
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Không thêm được."),
  });

  const drop = useMutation({
    mutationFn: async (target: string) => doRemove({ data: { email: target } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["allowed-teachers"] }),
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Không gỡ được."),
  });

  if (!isSuper) return null;

  return (
    <section className="mt-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="size-5" />
            Quản lý quản trị viên
          </CardTitle>
          <CardDescription>
            Chỉ những email trong danh sách này mới tạo được tài khoản giáo viên.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!email.trim()) return;
              add.mutate();
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email-quan-tri-phu@gmail.com"
              className="flex-1 rounded-xl border border-input bg-secondary px-4 py-2.5 text-[14px] outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <Button type="submit" disabled={add.isPending} className="gap-2">
              <Plus className="size-4" />
              Thêm quản trị phụ
            </Button>
          </form>

          {msg && (
            <p className="flex items-center gap-2 text-[13px] text-destructive">
              <AlertCircle className="size-4" />
              {msg}
            </p>
          )}

          <div className="divide-y divide-border rounded-xl border border-border">
            {isLoading && (
              <p className="px-4 py-4 text-sm text-muted-foreground">Đang tải danh sách…</p>
            )}
            {(admins ?? []).map((a) => (
              <div key={a.email} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.email}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {a.registered ? "Đã tạo tài khoản" : "Chưa tạo tài khoản"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={a.role === "super_admin" ? "default" : "secondary"}>
                    {a.role === "super_admin" ? "Quản trị chính" : "Quản trị phụ"}
                  </Badge>
                  {a.role !== "super_admin" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={drop.isPending}
                      onClick={() => drop.mutate(a.email)}
                      className="gap-1 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                      Gỡ
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function TopBar({ onSignOut }: { onSignOut: () => void }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Phòng thi trực tuyến</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Khu vực giáo viên</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link to="/">Trang học sinh</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={onSignOut} className="gap-2 text-muted-foreground">
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Đăng xuất</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

function StatsGrid({
  totalExams,
  liveExams,
  totalAttempts,
  isLoading,
}: {
  totalExams: number;
  liveExams: number;
  totalAttempts: number;
  isLoading: boolean;
}) {
  const items = [
    { label: "Tổng bài kiểm tra", value: totalExams, icon: BookOpen },
    { label: "Đang diễn ra", value: liveExams, icon: Play },
    { label: "Lượt làm bài", value: totalAttempts, icon: Users },
  ];

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="flex items-center gap-4 py-5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <item.icon className="size-5" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{isLoading ? "—" : item.value}</p>
              <p className="text-sm text-muted-foreground">{item.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CreateSection({
  form,
  setForm,
  previewUrl,
  error,
  isPending,
  onSubmit,
  onCreated,
}: {
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  previewUrl: string;
  error: string | null;
  isPending: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCreated: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="size-5 text-primary" />
          Tạo bài kiểm tra mới
        </CardTitle>
        <CardDescription>
          Chọn cách tạo phù hợp: nhúng Google Form hoặc để AI soạn câu hỏi từ đề có sẵn.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="manual" className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:w-auto">
            <TabsTrigger value="manual" className="gap-2">
              <FileText className="size-4" />
              Tạo thủ công
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Sparkles className="size-4" />
              Tạo bằng AI
            </TabsTrigger>
          </TabsList>
          <TabsContent value="manual" className="mt-5">
            <ManualForm
              form={form}
              setForm={setForm}
              previewUrl={previewUrl}
              error={error}
              isPending={isPending}
              onSubmit={onSubmit}
            />
          </TabsContent>
          <TabsContent value="ai" className="mt-5">
            <AiExamCreator onCreated={onCreated} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ManualForm({
  form,
  setForm,
  previewUrl,
  error,
  isPending,
  onSubmit,
}: {
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  previewUrl: string;
  error: string | null;
  isPending: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-muted-foreground">Tên bài kiểm tra</span>
          <input
            className={field}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Toán — Kiểm tra 15 phút"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-muted-foreground">Môn / lớp (không bắt buộc)</span>
          <input
            className={field}
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="Lớp 10A1"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["form", "Nhúng Google Form", "Học sinh làm trực tiếp trên biểu mẫu"],
            ["manual", "Tự nhập câu hỏi", "Hệ thống tự chấm điểm và lưu tên, lớp"],
          ] as const
        ).map(([key, label, hint]) => (
          <button
            key={key}
            type="button"
            onClick={() => setForm({ ...form, mode: key })}
            className={`rounded-2xl border p-4 text-left transition-colors ${
              form.mode === key ? "border-primary bg-primary/5" : "border-border bg-secondary hover:bg-muted"
            }`}
          >
            <span className="block text-sm font-semibold">{label}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-sm font-medium text-muted-foreground">
          {form.mode === "manual" ? "Link Google Form gốc (để tham khảo khi soạn câu hỏi)" : "Link Google Form"}
        </span>
        <input
          className={field}
          value={form.form_url}
          onChange={(e) => setForm({ ...form, form_url: e.target.value })}
          placeholder="https://docs.google.com/forms/..."
        />
      </label>

      {previewUrl && (
        <div className="mt-2">
          <p className="text-xs font-medium text-muted-foreground">Xem trước biểu mẫu</p>
          <div className="mt-2 overflow-hidden rounded-2xl border border-border">
            <iframe
              key={previewUrl}
              src={toEmbedUrl(previewUrl)}
              title="Xem trước biểu mẫu Google Form"
              className="h-[360px] w-full bg-background"
              loading="lazy"
            />
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium text-muted-foreground">Thời lượng (phút)</span>
          <input
            type="number"
            min={1}
            className={field}
            value={form.duration_minutes}
            onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-muted-foreground">Mở lúc</span>
          <input
            type="datetime-local"
            className={field}
            value={form.open_at}
            onChange={(e) => setForm({ ...form, open_at: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-muted-foreground">Đóng lúc</span>
          <input
            type="datetime-local"
            className={field}
            value={form.close_at}
            onChange={(e) => setForm({ ...form, close_at: e.target.value })}
          />
        </label>
      </div>

      <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-border bg-secondary px-4 py-3.5">
        <span className="text-sm font-medium">Cho học sinh vào làm bài</span>
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={form.registration_open}
          onChange={(e) => setForm({ ...form, registration_open: e.target.checked })}
        />
      </label>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {error}
        </div>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Đang lưu…" : "Tạo bài kiểm tra"}
      </Button>
    </form>
  );
}

function ExamCard({
  exam,
  canManage,
  open,
  onToggleOpen,
  onToggleStatus,
  onRemove,
}: {
  exam: Exam;
  canManage: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onToggleStatus: () => void;
  onRemove: () => void;
}) {
  const status = examStatus(exam);
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <button onClick={onToggleOpen} className="block w-full text-left">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold leading-tight sm:text-lg">{exam.title}</h3>
                <Badge variant={statusBadgeVariant(status)}>{statusLabel[status]}</Badge>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {exam.subject && <span>{exam.subject}</span>}
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {exam.duration_minutes} phút
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="size-3.5" />
                  Mở {formatDateTime(exam.open_at)}
                </span>
              </p>
            </div>
            <div className="shrink-0">
              {open ? <ChevronUp className="size-5 text-muted-foreground" /> : <ChevronDown className="size-5 text-muted-foreground" />}
            </div>
          </div>
          <p className="mt-3 text-xs font-medium text-primary">
            {open ? "Ẩn chi tiết" : "Mở để tạo câu hỏi bằng AI, sửa đề & xem bài đã làm"}
          </p>
        </CardContent>
      </button>

      {open && (
        <div className="border-t border-border bg-muted/30 px-5 py-5">
          <ExamDetail exam={exam} onToggleStatus={onToggleStatus} onRemove={onRemove} />
        </div>
      )}
    </Card>
  );
}

function ExamDetail({
  exam,
  onToggleStatus,
  onRemove,
}: {
  exam: Exam;
  onToggleStatus: () => void;
  onRemove: () => void;
}) {
  const { data: attempts, isLoading } = useQuery({
    queryKey: ["attempts", exam.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_attempts")
        .select("id, student_name, student_class, started_at, submitted_at, tab_switches, score")
        .eq("exam_id", exam.id)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data as Attempt[];
    },
    staleTime: 15_000,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild className="gap-2">
          <a href={`/thi/${exam.id}?test=1`} target="_blank" rel="noreferrer">
            <Eye className="size-4" />
            Xem thử
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={onToggleStatus} className="gap-2">
          {exam.registration_open ? <Pause className="size-4" /> : <Play className="size-4" />}
          {exam.registration_open ? "Đóng bài" : "Mở lại"}
        </Button>
        <Button variant="destructive" size="sm" onClick={onRemove} className="gap-2 ml-auto">
          <Trash2 className="size-4" />
          Xoá
        </Button>
      </div>

      <Tabs defaultValue="settings" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="settings" className="gap-2">
            <Edit3 className="size-4" />
            Cài đặt
          </TabsTrigger>
          <TabsTrigger value="questions" className="gap-2">
            <BookOpen className="size-4" />
            Sửa câu hỏi
          </TabsTrigger>
          <TabsTrigger value="students" className="gap-2">
            <Users className="size-4" />
            Sinh viên đã làm ({attempts?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-4 space-y-4">
          <EditExamForm exam={exam} onDone={() => undefined} />
          {exam.form_url && (
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Link2 className="size-3.5" />
                Link Google Form
              </p>
              <p className="mt-1 break-all text-sm">{exam.form_url}</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="questions" className="mt-4">
          <QuestionEditor examId={exam.id} />
        </TabsContent>

        <TabsContent value="students" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4 text-primary" />
                Sinh viên đã làm bài ({attempts?.length ?? 0})
              </CardTitle>
              <CardDescription>
                Bấm vào từng sinh viên để xem bài làm và các đáp án đã chọn.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
              {!isLoading && (attempts?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">Chưa có sinh viên nào làm bài.</p>
              )}
              <div className="space-y-2">
                {attempts?.map((a) => (
                  <AttemptRow key={a.id} examId={exam.id} attempt={a} />
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Một dòng sinh viên; mở ra để xem bài làm chi tiết. */
function AttemptRow({ examId, attempt }: { examId: string; attempt: Attempt }) {
  const [open, setOpen] = useState(false);
  const runReview = useServerFn(getAttemptReview);

  const { data: review, isLoading } = useQuery({
    queryKey: ["attempt-review", attempt.id],
    queryFn: async () => (await runReview({ data: { examId, attemptId: attempt.id } })) as ReviewQuestion[],
    enabled: open && !!attempt.submitted_at,
    staleTime: 60_000,
  });

  return (
    <div className="rounded-xl border border-border bg-secondary">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {attempt.student_name}
            {attempt.student_class ? ` · ${attempt.student_class}` : ""}
            {attempt.tab_switches > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                Chuyển tab {attempt.tab_switches}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Bắt đầu {formatDateTime(attempt.started_at)} · Nộp {formatDateTime(attempt.submitted_at)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums">
            {attempt.score !== null ? `${attempt.score}/10` : attempt.submitted_at ? "Đã nộp" : "Chưa nộp"}
          </span>
          {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-border px-3 py-3">
          {!attempt.submitted_at && (
            <p className="text-sm text-muted-foreground">Sinh viên chưa nộp bài.</p>
          )}
          {attempt.submitted_at && isLoading && (
            <p className="text-sm text-muted-foreground">Đang tải bài làm…</p>
          )}
          {attempt.submitted_at && review && review.length === 0 && (
            <p className="text-sm text-muted-foreground">Bài này không có câu hỏi tự chấm.</p>
          )}
          <div className="space-y-3">
            {review?.map((q, i) => (
              <div key={q.id} className="rounded-lg border border-border bg-card p-3">
                <p className="text-sm font-medium">
                  Câu {i + 1}. {q.prompt}
                </p>
                <div className="mt-2 space-y-1">
                  {q.options.map((opt, oi) => {
                    const chosen = q.chosenIndex === oi;
                    const correct = q.correctIndex === oi;
                    return (
                      <p
                        key={oi}
                        className={`rounded-md px-2 py-1 text-sm ${
                          correct
                            ? "bg-primary/10 font-medium text-primary"
                            : chosen
                              ? "bg-destructive/10 text-destructive"
                              : "text-muted-foreground"
                        }`}
                      >
                        {String.fromCharCode(65 + oi)}. {opt}
                        {chosen && <span className="ml-2 text-xs">(sinh viên chọn)</span>}
                        {correct && <span className="ml-2 text-xs">(đáp án đúng)</span>}
                      </p>
                    );
                  })}
                  {q.chosenIndex === null && (
                    <p className="text-xs italic text-muted-foreground">Không trả lời</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


function EditExamForm({ exam, onDone }: { exam: Exam; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({
    title: exam.title,
    subject: exam.subject ?? "",
    form_url: exam.form_url,
    duration_minutes: String(exam.duration_minutes),
    open_at: toLocalInput(exam.open_at),
    close_at: toLocalInput(exam.close_at),
    registration_open: exam.registration_open,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);


  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("exams")
        .update({
          title: draft.title.trim(),
          subject: draft.subject.trim() || null,
          form_url: draft.form_url.trim(),
          duration_minutes: Number(draft.duration_minutes) || 45,
          open_at: draft.open_at ? new Date(draft.open_at).toISOString() : null,
          close_at: draft.close_at ? new Date(draft.close_at).toISOString() : null,
          registration_open: draft.registration_open,
        })
        .eq("id", exam.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["my-exams"] });
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      onDone();
    },
    onError: () => setError("Không lưu được. Kiểm tra lại."),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) {
      setError("Cần có tên bài kiểm tra.");
      return;
    }
    save.mutate();
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Chỉnh sửa bài kiểm tra</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-muted-foreground">Tên bài kiểm tra</span>
              <input
                className={field}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-muted-foreground">Môn / lớp</span>
              <input
                className={field}
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-muted-foreground">Link Google Form</span>
            <input
              className={field}
              value={draft.form_url}
              onChange={(e) => setDraft({ ...draft, form_url: e.target.value })}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium text-muted-foreground">Thời lượng (phút)</span>
              <input
                type="number"
                min={1}
                className={field}
                value={draft.duration_minutes}
                onChange={(e) => setDraft({ ...draft, duration_minutes: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-muted-foreground">Mở lúc</span>
              <input
                type="datetime-local"
                className={field}
                value={draft.open_at}
                onChange={(e) => setDraft({ ...draft, open_at: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-muted-foreground">Đóng lúc</span>
              <input
                type="datetime-local"
                className={field}
                value={draft.close_at}
                onChange={(e) => setDraft({ ...draft, close_at: e.target.value })}
              />
            </label>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-border bg-secondary px-4 py-3.5">
            <span className="text-sm font-medium">Cho học sinh vào làm bài</span>
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={draft.registration_open}
              onChange={(e) => setDraft({ ...draft, registration_open: e.target.checked })}
            />
          </label>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="size-4" />
              {error}
            </div>
          )}

          <Button type="submit" disabled={save.isPending} className="w-full gap-2">
            <Save className="size-4" />
            {save.isPending ? "Đang lưu…" : saved ? "Đã lưu ✓" : "Lưu thay đổi"}
          </Button>

        </form>
      </CardContent>
    </Card>
  );
}

/** Bảng xem trước câu hỏi do AI soạn — giáo viên sửa trước khi lưu. */
function DraftList({
  drafts,
  setDrafts,
}: {
  drafts: DraftQuestion[];
  setDrafts: (next: DraftQuestion[]) => void;
}) {
  const update = (i: number, patch: Partial<DraftQuestion>) =>
    setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <div className="space-y-3">
      {drafts.map((d, i) => (
        <div key={i} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Câu {i + 1}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-1 text-xs text-destructive hover:text-destructive"
              onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
            >
              Xoá câu
            </Button>
          </div>

          <textarea
            className={`${field} min-h-[70px]`}
            value={d.prompt}
            onChange={(e) => update(i, { prompt: e.target.value })}
            placeholder="Nội dung câu hỏi"
          />

          <div className="mt-2 space-y-2">
            {d.options.map((opt, oi) => (
              <label key={oi} className="flex items-center gap-2.5">
                <input
                  type="radio"
                  className="size-4 accent-primary"
                  checked={d.correct_index === oi}
                  onChange={() => update(i, { correct_index: oi })}
                />
                <input
                  className="w-full rounded-xl border border-input bg-secondary px-3 py-2.5 text-sm outline-none focus:border-primary"
                  value={opt}
                  onChange={(e) =>
                    update(i, { options: d.options.map((o, j) => (j === oi ? e.target.value : o)) })
                  }
                  placeholder={`Phương án ${String.fromCharCode(65 + oi)}`}
                />
              </label>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => update(i, { options: [...d.options, ""] })}
            >
              + Phương án
            </Button>
            {d.options.length > 2 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => update(i, { options: d.options.slice(0, -1) })}
              >
                − Phương án
              </Button>
            )}
            <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              Điểm
              <input
                type="number"
                min={0}
                step="0.5"
                className="w-20 rounded-lg border border-input bg-secondary px-2 py-1.5 text-sm outline-none focus:border-primary"
                value={d.points}
                onChange={(e) => update(i, { points: Number(e.target.value) || 1 })}
              />
            </label>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
        onClick={() =>
          setDrafts([...drafts, { prompt: "", options: ["", "", "", ""], correct_index: 0, points: 1 }])
        }
      >
        <Plus className="size-4" />
        Thêm câu hỏi
      </Button>
    </div>
  );
}

function ImportPanel({ examId, onDone }: { examId: string; onDone: () => void }) {
  const runExtract = useServerFn(extractQuestions);
  const runSave = useServerFn(saveQuestions);
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const [drafts, setDrafts] = useState<DraftQuestion[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const pickFile = async (file: File) => {
    setErr(null);
    setMsg(null);
    setReading(true);
    try {
      const { readFileText } = await import("@/lib/read-file-text");
      const content = await readFileText(file);
      setText(content);
      setFileName(file.name);
      if (!content.trim()) setErr("Tệp này không có văn bản đọc được (có thể là ảnh scan).");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không đọc được tệp.");
    } finally {
      setReading(false);
    }
  };

  const run = useMutation({
    mutationFn: async () => {
      const res = await runExtract({
        data: {
          sourceUrl: url.trim() || undefined,
          sourceText: text.trim() || undefined,
        },
      });
      return res as DraftQuestion[];
    },
    onSuccess: (res) => {
      setErr(null);
      setDrafts(res);
      setMsg(`AI đã soạn ${res.length} câu hỏi. Kiểm tra và sửa lại trước khi lưu.`);
    },
    onError: (e) => {
      setMsg(null);
      setErr(e instanceof Error ? e.message : "Không nhập được đề.");
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const res = await runSave({ data: { examId, questions: drafts ?? [], replace } });
      return res as { imported: number };
    },
    onSuccess: async (res) => {
      setErr(null);
      await supabase.from("exams").update({ mode: "manual" }).eq("id", examId);
      qc.invalidateQueries({ queryKey: ["my-exams"] });
      qc.invalidateQueries({ queryKey: ["exams"] });
      setDrafts(null);
      setMsg(`Đã lưu ${res.imported} câu hỏi vào bài kiểm tra.`);
      onDone();
    },
    onError: (e) => {
      setMsg(null);
      setErr(e instanceof Error ? e.message : "Không lưu được câu hỏi.");
    },
  });

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" />
            Tạo câu hỏi tự động từ đề có sẵn
          </p>
          <p className="text-xs text-muted-foreground">
            Dán link biểu mẫu hoặc tải lên tệp PDF / Word chứa đề. Hệ thống soạn câu hỏi để bạn xem trước và
            chỉnh sửa, chỉ lưu khi bạn bấm lưu.
          </p>
        </div>

        {!drafts && (
          <>
            <input
              className={field}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Link đề (Google Form công khai, trang web…)"
            />

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-border bg-secondary px-4 py-3 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <FileUp className="size-4" />
                {reading ? "Đang đọc tệp…" : fileName || "Chọn tệp PDF, Word (.docx) hoặc .txt"}
              </span>
              <span className="font-semibold text-primary">Tải lên</span>
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pickFile(f);
                }}
              />
            </label>

            <textarea
              className={`${field} min-h-[80px]`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Hoặc dán trực tiếp nội dung đề vào đây"
            />

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              Xoá các câu hỏi hiện có trước khi lưu
            </label>
          </>
        )}

        {err && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
            <AlertCircle className="size-4" />
            {err}
          </div>
        )}
        {msg && (
          <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
            <Check className="size-4" />
            {msg}
          </div>
        )}

        {!drafts ? (
          <Button
            type="button"
            onClick={() => run.mutate()}
            disabled={run.isPending || reading || (!url.trim() && !text.trim())}
            className="w-full"
          >
            {run.isPending ? "Đang soạn câu hỏi…" : "Soạn câu hỏi bằng AI để xem trước"}
          </Button>
        ) : (
          <>
            <DraftList drafts={drafts} setDrafts={setDrafts} />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || drafts.length === 0}
                className="flex-1 gap-2"
              >
                <Save className="size-4" />
                {save.isPending ? "Đang lưu…" : `Lưu ${drafts.length} câu hỏi`}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDrafts(null)}>
                Huỷ
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function QuestionEditor({ examId }: { examId: string }) {
  const queryClient = useQueryClient();
  const { data: questions, isLoading } = useQuery({
    queryKey: ["questions", examId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_questions")
        .select("id, position, prompt, options, correct_index, points")
        .eq("exam_id", examId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((q) => ({
        id: q.id,
        position: q.position,
        prompt: q.prompt,
        options: Array.isArray(q.options) ? (q.options as unknown[]).map(String) : [],
        correct_index: q.correct_index,
        points: Number(q.points),
      })) as Question[];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["questions", examId] });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("exam_questions").insert({
        exam_id: examId,
        position: questions?.length ?? 0,
        prompt: "",
        options: ["", "", "", ""],
        correct_index: 0,
        points: 1,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="size-4 text-primary" />
          Câu hỏi tự nhập ({questions?.length ?? 0})
        </CardTitle>
        <CardDescription>
          Nhập lại từng câu theo đúng biểu mẫu gốc và tích vào đáp án đúng. Điểm được quy về thang 10.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ImportPanel examId={examId} onDone={refresh} />

        {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}

        <div className="space-y-3">
          {questions?.map((q, i) => (
            <QuestionCard key={q.id} question={q} index={i} onChanged={refresh} />
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => add.mutate()}
          disabled={add.isPending}
          className="w-full gap-2"
        >
          <Plus className="size-4" />
          Thêm câu hỏi
        </Button>
      </CardContent>
    </Card>
  );
}

function QuestionCard({
  question,
  index,
  onChanged,
}: {
  question: Question;
  index: number;
  onChanged: () => void;
}) {
  const [prompt, setPrompt] = useState(question.prompt);
  const [options, setOptions] = useState<string[]>(
    question.options.length ? question.options : ["", "", "", ""],
  );
  const [correct, setCorrect] = useState(question.correct_index);
  const [points, setPoints] = useState(String(question.points));
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const clean = options.map((o) => o.trim()).filter((o) => o.length > 0);
      const { error } = await supabase
        .from("exam_questions")
        .update({
          prompt: prompt.trim(),
          options: clean,
          correct_index: Math.min(correct, Math.max(0, clean.length - 1)),
          points: Number(points) || 1,
          position: index,
        })
        .eq("id", question.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onChanged();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("exam_questions").delete().eq("id", question.id);
      if (error) throw error;
    },
    onSuccess: onChanged,
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">Câu {index + 1}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => remove.mutate()} className="h-auto px-2 py-1 text-xs text-destructive hover:text-destructive">
          Xoá câu
        </Button>
      </div>

      <textarea
        className={`${field} min-h-[70px]`}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Nội dung câu hỏi"
      />

      <div className="mt-2 space-y-2">
        {options.map((opt, i) => (
          <label key={i} className="flex items-center gap-2.5">
            <input
              type="radio"
              className="size-4 accent-primary"
              checked={correct === i}
              onChange={() => setCorrect(i)}
            />
            <input
              className="w-full rounded-xl border border-input bg-secondary px-3 py-2.5 text-sm outline-none focus:border-primary"
              value={opt}
              onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
              placeholder={`Phương án ${String.fromCharCode(65 + i)}`}
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setOptions([...options, ""])}>
          + Phương án
        </Button>
        {options.length > 2 && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOptions(options.slice(0, -1))}>
            − Phương án
          </Button>
        )}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          Điểm
          <input
            type="number"
            min={0}
            step="0.5"
            className="w-20 rounded-lg border border-input bg-secondary px-2 py-1.5 text-sm outline-none focus:border-primary"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
        </label>
      </div>

      <Button
        type="button"
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="mt-4 w-full gap-2"
      >
        <Save className="size-4" />
        {save.isPending ? "Đang lưu…" : saved ? "Đã lưu ✓" : "Lưu câu hỏi"}
      </Button>
    </div>
  );
}

function AiExamCreator({ onCreated }: { onCreated: (id: string) => void }) {
  const runExtract = useServerFn(extractQuestions);
  const runSave = useServerFn(saveQuestions);
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [duration, setDuration] = useState("45");
  const [openAt, setOpenAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [registrationOpen, setRegistrationOpen] = useState(true);

  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [drafts, setDrafts] = useState<DraftQuestion[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pickFile = async (file: File) => {
    setErr(null);
    setMsg(null);
    setReading(true);
    try {
      const { readFileText } = await import("@/lib/read-file-text");
      const content = await readFileText(file);
      setText(content);
      setFileName(file.name);
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
      if (!content.trim()) setErr("Tệp này không có văn bản đọc được (có thể là ảnh scan).");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không đọc được tệp.");
    } finally {
      setReading(false);
    }
  };

  const run = useMutation({
    mutationFn: async () => {
      const res = await runExtract({
        data: {
          sourceUrl: url.trim() || undefined,
          sourceText: text.trim() || undefined,
        },
      });
      return res as DraftQuestion[];
    },
    onSuccess: (res) => {
      setErr(null);
      setDrafts(res);
      setMsg(`AI đã soạn ${res.length} câu hỏi. Xem lại, chỉnh sửa rồi bấm “Lưu bài kiểm tra”.`);
    },
    onError: (e) => {
      setMsg(null);
      setErr(e instanceof Error ? e.message : "Không soạn được câu hỏi.");
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Chưa đăng nhập");
      const { data: exam, error } = await supabase
        .from("exams")
        .insert({
          teacher_id: uid,
          title: title.trim() || "Bài kiểm tra tạo bằng AI",
          subject: subject.trim() || null,
          form_url: url.trim() || "",
          duration_minutes: Number(duration) || 45,
          open_at: openAt ? new Date(openAt).toISOString() : null,
          close_at: closeAt ? new Date(closeAt).toISOString() : null,
          registration_open: registrationOpen,

          mode: "manual",
        })
        .select("id")
        .single();
      if (error) throw error;
      const res = (await runSave({
        data: { examId: exam.id as string, questions: drafts ?? [], replace: true },
      })) as { imported: number };
      return { id: exam.id as string, imported: res.imported };
    },
    onSuccess: ({ id, imported }) => {
      setErr(null);
      setMsg(`Đã tạo bài kiểm tra với ${imported} câu hỏi.`);
      setDrafts(null);
      setText("");
      setFileName("");
      setUrl("");
      qc.invalidateQueries({ queryKey: ["my-exams"] });
      qc.invalidateQueries({ queryKey: ["exams"] });
      qc.invalidateQueries({ queryKey: ["questions", id] });
      qc.invalidateQueries({ queryKey: ["teacher-stats"] });
      onCreated(id);
    },
    onError: (e) => {
      setMsg(null);
      setErr(e instanceof Error ? e.message : "Không tạo được bài kiểm tra.");
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-muted-foreground">Tên bài kiểm tra</span>
          <input
            className={field}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ôn tập chương 1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-muted-foreground">Môn / lớp</span>
          <input
            className={field}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Lớp 10A1"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium text-muted-foreground">Thời lượng (phút)</span>
          <input type="number" min={1} className={field} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-muted-foreground">Mở lúc</span>
          <input
            type="datetime-local"
            className={field}
            value={openAt}
            onChange={(e) => setOpenAt(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-muted-foreground">Đóng lúc</span>
          <input
            type="datetime-local"
            className={field}
            value={closeAt}
            onChange={(e) => setCloseAt(e.target.value)}
          />
        </label>
      </div>

      <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-border bg-secondary px-4 py-3.5">
        <span className="text-sm font-medium">Cho học sinh vào làm bài</span>
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={registrationOpen}
          onChange={(e) => setRegistrationOpen(e.target.checked)}
        />
      </label>


      {!drafts && (
        <>
          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-primary/40 bg-secondary px-4 py-4 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <FileUp className="size-4" />
              {reading ? "Đang đọc tệp…" : fileName || "Chọn tệp đề: PDF, Word (.docx) hoặc .txt"}
            </span>
            <span className="font-semibold text-primary">Tải lên</span>
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickFile(f);
              }}
            />
          </label>

          <input
            className={field}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Hoặc dán link đề (Google Form công khai, trang web…)"
          />

          <textarea
            className={`${field} min-h-[80px]`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Hoặc dán trực tiếp nội dung đề vào đây"
          />
        </>
      )}

      {err && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          <AlertCircle className="size-4" />
          {err}
        </div>
      )}
      {msg && (
        <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
          <Check className="size-4" />
          {msg}
        </div>
      )}

      {!drafts ? (
        <Button
          type="button"
          onClick={() => run.mutate()}
          disabled={run.isPending || reading || (!url.trim() && !text.trim())}
          className="w-full gap-2"
        >
          <Sparkles className="size-4" />
          {run.isPending ? "AI đang soạn câu hỏi…" : "Soạn câu hỏi bằng AI để xem trước"}
        </Button>
      ) : (
        <>
          <p className="text-sm font-semibold">Xem trước và chỉnh sửa ({drafts.length} câu)</p>
          <DraftList drafts={drafts} setDrafts={setDrafts} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || drafts.length === 0}
              className="flex-1 gap-2"
            >
              <Save className="size-4" />
              {save.isPending ? "Đang lưu…" : "Lưu bài kiểm tra"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDrafts(null)}>
              Soạn lại
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
