import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  createSession,
  destroySession,
  errorResponse,
  getCurrentUser,
  HttpError,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,40}$/;

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "Corpo da requisição inválido.");
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await ctx.params;
    if (action !== "me") throw new HttpError(404, "Não encontrado.");
    const user = await getCurrentUser();
    return Response.json({ user });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await ctx.params;

    if (action === "logout") {
      await destroySession();
      return Response.json({ ok: true });
    }

    const body = await readJson(request);
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");

    if (action === "register") {
      if (!USERNAME_RE.test(username)) {
        throw new HttpError(400, "Usuário deve ter de 3 a 40 caracteres: letras, números, ponto, hífen ou sublinhado.");
      }
      if (password.length < 6 || password.length > 200) {
        throw new HttpError(400, "A senha deve ter entre 6 e 200 caracteres.");
      }
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
      if (existing.length) throw new HttpError(409, "Este nome de usuário já está em uso.");
      const [created] = await db
        .insert(users)
        .values({ username, passwordHash: await hashPassword(password), role: "player" })
        .returning({ id: users.id, username: users.username, role: users.role });
      await createSession(created.id);
      return Response.json({ user: created });
    }

    if (action === "login") {
      const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
      const row = rows[0];
      // Mensagem genérica para não revelar quais usuários existem.
      if (!row || !(await verifyPassword(password, row.passwordHash))) {
        throw new HttpError(401, "Usuário ou senha incorretos.");
      }
      await createSession(row.id);
      return Response.json({ user: { id: row.id, username: row.username, role: row.role } });
    }

    throw new HttpError(404, "Não encontrado.");
  } catch (error) {
    return errorResponse(error);
  }
}
