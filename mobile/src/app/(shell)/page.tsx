import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@/lib/i18n/translations";
import { getLocale } from "@/app/actions/locale";
import { getCurrentUser } from "@/lib/auth/cookies";
import { Button } from "@/components/ui/button";

export default async function Home() {
    const token = await getCurrentUser();

    // Auto redirect to dashboard if authenticated
    if (token) {
        redirect("/dashboard");
    }

    const locale = await getLocale();

    return (
        <section
            data-component="mobile_home_page"
            className="flex flex-col items-center justify-center h-screen"
        >
            <h1 className="mb-2 text-3xl font-bold text-foreground">
                {t(locale, "common.title")}
            </h1>
            <p className="mb-4 text-lg text-muted-foreground">
                {t(locale, "common.subtitle")}
            </p>
            <Button asChild size="lg" className="min-w-[160px]">
                <Link href="/login">{t(locale, "common.start")}</Link>
            </Button>
        </section>
    );
}
