import type { Metadata } from "next";
import { Manrope, Playfair_Display } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "16° ECC - CONVERSA Á TRÊS - ENCONTRO DE CASAIS",
  description: "Agendamento de horários para o 16° ECC - Conversa Á Três - Encontro de Casais",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${manrope.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="flex-1">{children}</div>

        <footer className="border-t border-slate-200 bg-white/90 px-4 py-4 backdrop-blur-sm sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm font-semibold text-slate-700">Site desenvolvido por Kauan Altino.</p>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="https://github.com/KauanAltino"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                GitHub
              </a>
              <a
                href="https://www.linkedin.com/in/kauanaltino/"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                LinkedIn
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
