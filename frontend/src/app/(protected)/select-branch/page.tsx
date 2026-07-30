"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { AuthPanel } from "@/components/auth/auth-panel";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { FooterNavigation } from "@/components/ui/footer-navigation";
import { getRoleLabel } from "@/lib/constants/roles";
import { getUserBranches, setCurrentBranch } from "./actions";

interface Branch {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    role: string;
}

const BRANCHES_PER_PAGE = 5;

function SelectBranchLoadingSkeleton() {
    return (
        <div data-component="desktop_select-branch_loading" className="flex w-full flex-1 flex-col gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
                <Card
                    key={index}
                    data-component="desktop_select-branch_loading_card"
                    className="rounded-[24px] border-[1.35px] border-v3-border bg-white shadow-[0_4px_24px_hsla(214,50%,20%,0.06)]"
                >
                    <CardContent className="p-4">
                        <div data-component="desktop_select-branch_loading_card_row" className="flex items-center justify-between gap-4">
                            <div data-component="desktop_select-branch_loading_card_row_main" className="flex min-w-0 items-center gap-3">
                                <Skeleton className="h-11 w-11 shrink-0 rounded-[18px] bg-v3-dim-white" />
                                <div data-component="desktop_select-branch_loading_card_row_main_copy" className="min-w-0 flex-1 space-y-2">
                                    <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                                    <Skeleton className="h-3 w-48 max-w-full bg-v3-dim-white" />
                                </div>
                            </div>
                            <Skeleton className="h-6 w-16 shrink-0 rounded-full bg-v3-dim-white" />
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

export default function SelectBranchPage() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selecting, setSelecting] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);

    const handleSelectBranch = useCallback(async (branchId: string): Promise<boolean> => {
        setSelecting(branchId);

        try {
            const result = await setCurrentBranch(branchId);

            if (!result.success) {
                setError(result.error || "지점 선택에 실패했습니다.");
                setSelecting(null);
                return false;
            }

            // 지점 전환 시 이전 지점의 React Query 캐시(고객 목록·전자계약 등)를 모두 비운다.
            // QueryClient는 브라우저 싱글톤이라 soft navigation(router.replace) 후에도
            // 유지되므로, 비우지 않으면 이전 지점 데이터가 새로고침 전까지 그대로 남는다.
            queryClient.clear();

            router.replace("/dashboard");
            return true;
        } catch (err) {
            console.error("[Select Branch] Error selecting branch:", err);
            setError("지점 선택에 실패했습니다.");
            setSelecting(null);
            return false;
        }
    }, [router, queryClient]);

    useEffect(() => {
        const fetchBranches = async () => {
            let keepLoadingForNavigation = false;
            try {
                const result = await getUserBranches();

                if (!result.success) {
                    setError(result.error || "지점 목록을 불러오는데 실패했습니다.");
                    return;
                }

                // If user has only one branch AND is not an owner, auto-select it
                // Owners should always see the selection screen to explicitly choose
                const isOwner = result.branches?.some(org => org.role === 'owner');
                if (result.branches?.length === 1 && !isOwner) {
                    const org = result.branches[0];
                    keepLoadingForNavigation = await handleSelectBranch(org.id);
                    return;
                }

                setBranches(result.branches || []);
                setCurrentPage(1);
            } catch (err) {
                console.error("[Select Branch] Error fetching branches:", err);
                setError("지점 목록을 불러오는데 실패했습니다.");
            } finally {
                if (!keepLoadingForNavigation) {
                    setLoading(false);
                }
            }
        };

        fetchBranches();
    }, [handleSelectBranch]);

    if (loading) {
        return (
            <AuthPanel
                dataComponents={{
                    container: "desktop_select-branch",
                    card: "desktop_select-branch_container",
                    header: "desktop_select-branch_header",
                    title: "desktop_select-branch_title",
                    subtitle: "desktop_select-branch_subtitle",
                    content: "desktop_select-branch_content",
                }}
                containerClassName="!h-full min-h-0 items-center overflow-hidden py-0 md:py-0"
                className="min-h-[70vh] gap-5 !p-5 sm:!p-6 [&_[data-component='select-branch-title']]:!text-[1.72rem] md:[&_[data-component='select-branch-title']]:!text-[1.5rem] [&_[data-component='select-branch-subtitle']]:!max-w-[30ch] [&_[data-component='select-branch-subtitle']]:!text-[0.82rem] md:[&_[data-component='select-branch-subtitle']]:!text-[0.76rem]"
                contentClassName="flex-1 gap-5"
                title="지점 불러오는 중"
                subtitle="계정에 연결된 지점을 정리하고 있습니다."
            >
                <SelectBranchLoadingSkeleton />
            </AuthPanel>
        );
    }

    if (error) {
        return (
            <AuthPanel
                dataComponents={{
                    container: "desktop_select-branch",
                    card: "desktop_select-branch_container",
                    header: "desktop_select-branch_header",
                    title: "desktop_select-branch_title",
                    subtitle: "desktop_select-branch_subtitle",
                    content: "desktop_select-branch_content",
                }}
                containerClassName="!h-full min-h-0 items-center overflow-hidden py-0 md:py-0"
                className="min-h-[70vh] gap-5 !p-5 sm:!p-6 [&_[data-component='select-branch-title']]:!text-[1.72rem] md:[&_[data-component='select-branch-title']]:!text-[1.5rem] [&_[data-component='select-branch-subtitle']]:!max-w-[30ch] [&_[data-component='select-branch-subtitle']]:!text-[0.82rem] md:[&_[data-component='select-branch-subtitle']]:!text-[0.76rem]"
                contentClassName="flex-1 gap-5"
                title="지점을 불러오지 못했습니다"
                subtitle="권한 확인 또는 다시 로그인이 필요할 수 있습니다."
            >
                <div data-component="desktop_select-branch_error" className="flex flex-col items-center gap-4 text-center">
                    <p className="rounded-full bg-destructive/10 px-3 py-1 text-sm font-semibold text-destructive">
                        {error}
                    </p>
                    <Button variant="outline" onClick={() => router.push("/login")}>
                        로그인 페이지로 돌아가기
                    </Button>
                </div>
            </AuthPanel>
        );
    }

    if (branches.length === 0) {
        return (
            <AuthPanel
                dataComponents={{
                    container: "desktop_select-branch",
                    card: "desktop_select-branch_container",
                    header: "desktop_select-branch_header",
                    title: "desktop_select-branch_title",
                    subtitle: "desktop_select-branch_subtitle",
                    content: "desktop_select-branch_content",
                }}
                containerClassName="!h-full min-h-0 items-center overflow-hidden py-0 md:py-0"
                className="min-h-[70vh] gap-5 !p-5 sm:!p-6 [&_[data-component='select-branch-title']]:!text-[1.72rem] md:[&_[data-component='select-branch-title']]:!text-[1.5rem] [&_[data-component='select-branch-subtitle']]:!max-w-[30ch] [&_[data-component='select-branch-subtitle']]:!text-[0.82rem] md:[&_[data-component='select-branch-subtitle']]:!text-[0.76rem]"
                contentClassName="flex-1 gap-5"
                title="접근 가능한 지점이 없습니다"
                subtitle="관리자에게 지점 접근 권한을 요청한 뒤 다시 시도해 주세요."
            >
                <div data-component="desktop_select-branch_empty-state" className="flex flex-col items-center gap-6 text-center">
                    <div data-component="desktop_select-branch_empty-state_icon" className="flex h-16 w-16 items-center justify-center rounded-full bg-v3-primary/8 text-v3-primary">
                        <Building2 className="h-8 w-8" />
                    </div>
                    <div data-component="desktop_select-branch_empty-state_copy">
                        <p className="text-sm text-v3-text-muted">
                            권한이 부여되면 이 페이지를 새로고침하세요.
                        </p>
                    </div>
                    <div data-component="desktop_select-branch_empty-state_actions" className="flex gap-3">
                        <Button onClick={() => window.location.reload()}>
                            새로고침
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => {
                                // Clear auth cookies and redirect to login
                                document.cookie = "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
                                document.cookie = "refresh_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
                                document.cookie = "selected_branch_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
                                router.replace("/login");
                            }}
                        >
                            로그아웃
                        </Button>
                    </div>
                </div>
            </AuthPanel>
        );
    }

    const getRoleBadgeVariant = (role: string) => {
        switch (role) {
            case "owner":
                return "secondary";
            case "admin":
                return "default";
            default:
                return "outline";
        }
    };

    const totalPages = Math.max(1, Math.ceil(branches.length / BRANCHES_PER_PAGE));
    const pageStartIndex = (currentPage - 1) * BRANCHES_PER_PAGE;
    const paginatedBranches = branches.slice(
        pageStartIndex,
        pageStartIndex + BRANCHES_PER_PAGE,
    );



    return (
        <AuthPanel
            dataComponents={{
                container: "desktop_select-branch",
                card: "desktop_select-branch_container",
                header: "desktop_select-branch_header",
                title: "desktop_select-branch_title",
                subtitle: "desktop_select-branch_subtitle",
                content: "desktop_select-branch_content",
            }}
            containerClassName="!h-full min-h-0 items-center overflow-hidden py-0 md:py-0"
            className="min-h-[70vh] gap-5 !p-5 sm:!p-6 [&_[data-component='select-branch-title']]:!text-[1.72rem] md:[&_[data-component='select-branch-title']]:!text-[1.5rem] [&_[data-component='select-branch-subtitle']]:!max-w-[30ch] [&_[data-component='select-branch-subtitle']]:!text-[0.82rem] md:[&_[data-component='select-branch-subtitle']]:!text-[0.76rem]"
            contentClassName="flex-1 gap-5"
            title="지점 선택"
            subtitle="지점을 선택해 주세요."
        >
            <div data-component="desktop_select-branch_list" className="flex w-full flex-1 flex-col gap-3">
                {paginatedBranches.map((org) => (
                    <Card
                        key={org.id}
                        className={`cursor-pointer rounded-[24px] border-[1.35px] border-v3-border bg-white shadow-[0_4px_24px_hsla(214,50%,20%,0.06)] transition-all duration-300 ease-in-out hover:-translate-y-1 hover:border-v3-primary/35 hover:shadow-[0_12px_48px_hsla(214,50%,20%,0.12)] ${
                            selecting ? "opacity-60 cursor-not-allowed" : ""
                        }`}
                        onClick={() => !selecting && handleSelectBranch(org.id)}
                    >
                        <CardContent className="p-4">
                            <div data-component="desktop_select-branch_list_card-row" className="flex items-center justify-between gap-4">
                                <div data-component="desktop_select-branch_list_card-row_main" className="flex items-center gap-3">
                                    <Avatar className="h-11 w-11 rounded-[18px] bg-[linear-gradient(180deg,hsl(214,100%,34%),hsl(214,92%,28%))] ring-1 ring-v3-primary/15">
                                        <AvatarFallback className="rounded-[18px] bg-transparent text-primary-foreground">
                                            <Building2 className="w-5 h-5" />
                                        </AvatarFallback>
                                    </Avatar>
                                    <div data-component="desktop_select-branch_list_card-row_main_text" className="flex min-w-0 flex-col gap-1">
                                        <h3 className="text-base font-semibold tracking-[-0.02em] text-v3-dark">
                                            {org.name}
                                        </h3>
                                        {org.description && (
                                            <p className="text-sm leading-5 text-v3-text-muted">
                                                {org.description}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                {selecting === org.id ? (
                                    <div data-component="desktop_select-branch_list_card-row_spinner" className="flex h-8 w-8 items-center justify-center rounded-full bg-v3-primary/10">
                                        <Spinner size="sm" className="text-v3-primary" />
                                    </div>
                                ) : (
                                    <Badge
                                        variant={getRoleBadgeVariant(org.role)}
                                        className="px-2.5 py-1 text-[0.72rem] font-semibold"
                                    >
                                        {getRoleLabel(org.role)}
                                    </Badge>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
            <FooterNavigation
                dataComponent="desktop_select-branch_pagination"
                prevDataComponent="desktop_select-branch_pagination-prev"
                nextDataComponent="desktop_select-branch_pagination-next"
                positionDataComponent="desktop_select-branch_pagination-position"
                positionLabel={`${currentPage} / ${totalPages}`}
                prevVariant="outline"
                nextVariant="outline"
                prevDisabled={currentPage === 1 || Boolean(selecting)}
                nextDisabled={currentPage === totalPages || Boolean(selecting)}
                onPrev={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                onNext={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                prevClassName="w-1/4 min-w-[96px] justify-self-start"
                nextClassName="w-1/4 min-w-[96px] justify-self-end"
            />
        </AuthPanel>
    );
}
