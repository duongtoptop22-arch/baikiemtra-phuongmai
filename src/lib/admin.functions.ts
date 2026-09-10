import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminRole = "super_admin" | "admin";

export type AllowedTeacher = {
  email: string;
  role: AdminRole;
  registered: boolean;
  created_at: string;
};

const normalize = (email: string) => String(email ?? "").trim().toLowerCase();

/** Tạo tài khoản giáo viên — chỉ cho email nằm trong danh sách được phép. */
export const signUpTeacher = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string }) => {
    const email = normalize(data?.email);
    const password = String(data?.password ?? "");
    if (!email.includes("@")) throw new Error("Email không hợp lệ.");
    if (password.length < 6) throw new Error("Mật khẩu cần ít nhất 6 ký tự.");
    return { email, password };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: allowed, error: allowErr } = await supabaseAdmin
      .from("allowed_teachers")
      .select("email, role")
      .eq("email", data.email)
      .maybeSingle();
    if (allowErr) throw new Error(allowErr.message);
    if (!allowed) {
      throw new Error("Email này chưa được cấp quyền tạo tài khoản. Hãy liên hệ quản trị viên chính.");
    }

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    const userId = created.user?.id;
    if (!userId) throw new Error("Không tạo được tài khoản.");

    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: allowed.role }, { onConflict: "user_id,role" });
    if (roleErr) throw new Error(roleErr.message);

    return { ok: true as const, role: allowed.role as AdminRole };
  });

/** Vai trò của người đang đăng nhập. */
export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ role: AdminRole | null; email: string | null }> => {
    const { data, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const roles = (data ?? []).map((r) => r.role as AdminRole);
    const role = roles.includes("super_admin") ? "super_admin" : (roles[0] ?? null);
    return { role, email: (context.claims['email'] as string | undefined) ?? null };
  });

async function assertSuperAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Chỉ quản trị viên chính mới thực hiện được thao tác này.");
  return supabaseAdmin;
}

/** Danh sách quản trị viên (chỉ quản trị chính). */
export const listAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AllowedTeacher[]> => {
    const admin = await assertSuperAdmin(context.userId);
    const { data, error } = await admin
      .from("allowed_teachers")
      .select("email, role, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const registered = new Set((users?.users ?? []).map((u) => normalize(u.email ?? "")));

    return (data ?? []).map((r) => ({
      email: r.email,
      role: r.role as AdminRole,
      created_at: r.created_at,
      registered: registered.has(normalize(r.email)),
    }));
  });

/** Thêm quản trị viên phụ (chỉ quản trị chính). */
export const addAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string }) => {
    const email = normalize(data?.email);
    if (!email.includes("@")) throw new Error("Email không hợp lệ.");
    return { email };
  })
  .handler(async ({ context, data }) => {
    const admin = await assertSuperAdmin(context.userId);
    const { error } = await admin
      .from("allowed_teachers")
      .upsert({ email: data.email, role: "admin" }, { onConflict: "email" });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Gỡ quyền một quản trị viên phụ (chỉ quản trị chính). */
export const removeAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string }) => {
    const email = normalize(data?.email);
    if (!email) throw new Error("Thiếu email.");
    return { email };
  })
  .handler(async ({ context, data }) => {
    const admin = await assertSuperAdmin(context.userId);

    const { data: row, error: rowErr } = await admin
      .from("allowed_teachers")
      .select("email, role")
      .eq("email", data.email)
      .maybeSingle();
    if (rowErr) throw new Error(rowErr.message);
    if (!row) return { ok: true as const };
    if (row.role === "super_admin") throw new Error("Không thể gỡ quản trị viên chính.");

    const { error } = await admin.from("allowed_teachers").delete().eq("email", data.email);
    if (error) throw new Error(error.message);

    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const target = (users?.users ?? []).find((u) => normalize(u.email ?? "") === data.email);
    if (target) await admin.auth.admin.deleteUser(target.id);

    return { ok: true as const };
  });
