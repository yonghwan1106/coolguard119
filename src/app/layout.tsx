import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "쿨가드 119 — 폭염 구급수요 예보 & 무더위쉼터 공백지대 콘솔",
  description:
    "소방안전 빅데이터 플랫폼 온열질환-무더위쉼터 융합데이터로 생활권 단위 온열 구급수요를 예보하고, '출동은 많은데 쉼터는 먼' 공백지대를 진단하는 기후성 구급 대응 콘솔. 제6회 소방안전 빅데이터 활용 및 아이디어 경진대회.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
