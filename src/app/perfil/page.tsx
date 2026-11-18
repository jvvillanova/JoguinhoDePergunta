import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Estatísticas, histórico e ranking ficam na página inicial (seção #estatisticas). */
export default function PerfilPage() {
  redirect("/#estatisticas");
}
