import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { signUpTeacher } from "@/lib/admin.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Đăng nhập giáo viên — Phòng thi trực tuyến" },
      { name: "description", content: "Khu vực dành cho giáo viên quản lý các bài kiểm tra." },
      { property: "og:title", content: "Đăng nhập giáo viên" },
      { property: "og:description", content: "Quản lý bài kiểm tra Google Form." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/quan-ly", replace: true });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) return setMessage("Email hoặc mật khẩu chưa đúng.");
      navigate({ to: "/quan-ly", replace: true });
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      setLoading(false);
      if (error) return setMessage(error.message);
      if (data.session) navigate({ to: "/quan-ly", replace: true });
      else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) return setMessage("Tạo tài khoản xong, hãy đăng nhập lại.");
        navigate({ to: "/quan-ly", replace: true });
      }
    }
  };

  return (
    <div className="paper grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-sm">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Trang học sinh
        </Link>

        <div className="mt-4 rounded-3xl border border-border bg-card p-8 shadow-sm">
          <div className="text-center">
            <h1 className="text-[22px] font-bold">
              {mode === "login" ? "Khu vực Giáo viên" : "Tạo tài khoản"}
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {mode === "login" ? "Quản lý đề thi và xem kết quả lớp học" : "Bắt đầu quản lý bài kiểm tra"}
            </p>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5 ml-1">
                Email công vụ
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-input bg-secondary px-4 py-3 text-[14px] text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                placeholder="giaovien@truong.edu.vn"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-muted-foreground mb-1.5 ml-1">
                Mật khẩu
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-input bg-secondary px-4 py-3 text-[14px] text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                placeholder="••••••••"
              />
            </div>
            {message && <p className="text-[12px] text-destructive">{message}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-foreground py-3.5 text-[15px] font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
            >
              {loading ? "Đang xử lý…" : mode === "login" ? "Đăng nhập Giáo viên" : "Tạo tài khoản"}
            </button>
          </form>

          <button
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setMessage(null);
            }}
            className="mt-5 w-full text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {mode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
          </button>
        </div>
      </div>
    </div>
  );
}
