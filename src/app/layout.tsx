import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Palco do Saber — Game show de conhecimentos",
  description: "Jogo de perguntas e respostas com apresentador, trilha sonora, ajudas e premiação virtual.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
