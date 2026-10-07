import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { currentPreferences } from "@/lib/supabase/auth";
import { documentAttributes } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.brand");
  return { title: { default: "Tecfys", template: "%s · Tecfys" }, description: t("description") };
}

/**
 * The user's preferences reach every page from here, on the server: the
 * language as <html lang> and as the messages of NextIntlClientProvider (so
 * client components translate too, with no hydration mismatch), and the theme
 * mode as <html data-theme> - the seam the palette in globals.css hangs from.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const preferences = await currentPreferences();
  return (
    <html {...documentAttributes(preferences)} className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
