'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getFeedbackList, getFeedbackStats, FeedbackItem } from '@/lib/api/admin';
import { cn } from '@/lib/utils';
import { MessageSquare, ThumbsUp, ThumbsDown, Sparkles, Send, Users, MessageCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { StatsBar, ListPanel, AnimatedSlotList, ListEmptyState } from '@/components/app/v3';
import { ShortcutGrid } from '@/components/app/v3/ShortcutGrid';

type FilterType = 'all' | 'positive' | 'negative';

const filterItems = [
  { label: '전체', value: 'all' },
  { label: '긍정적', value: 'positive' },
  { label: '부정적', value: 'negative' },
];

export default function AdminFeedbackPage() {
  const router = useRouter();
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const shortcuts = useMemo(
    () => [
      { href: '/chat', label: 'AI 어시스턴트', icon: Sparkles },
      { href: '/contracts/new', label: '계약 발송', icon: Send },
      { href: '/clients', label: '고객', icon: Users },
      { href: '/messages', label: '메시지', icon: MessageCircle },
    ],
    []
  );

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['feedbackStats'],
    queryFn: getFeedbackStats,
  });

  const { data: feedbackData, isLoading: feedbackLoading, error } = useQuery({
    queryKey: ['feedbackList', 1, filterType],
    queryFn: () => getFeedbackList(1, 100, filterType === 'all' ? undefined : filterType),
  });

  const feedbackList = useMemo(() => feedbackData?.data ?? [], [feedbackData?.data]);

  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return feedbackList;
    const q = searchQuery.trim().toLowerCase();
    return feedbackList.filter((f) =>
      f.user.name?.toLowerCase().includes(q) ||
      f.user.email?.toLowerCase().includes(q) ||
      f.comment?.toLowerCase().includes(q)
    );
  }, [feedbackList, searchQuery]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncateText = (text: string | null, maxLength: number) => {
    if (!text) return '-';
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  };

  if (error) {
    return (
      <div data-component="admin-feedback-error-wrap" className="p-6">
        <div data-component="admin-error" className="bg-v3-burgundy-light text-v3-burgundy rounded-2xl p-6 text-center">
          피드백을 불러오는데 실패했습니다.
        </div>
      </div>
    );
  }

  return (
    <section data-component="admin-feedback" className="space-y-6">
      <StatsBar
        name="admin"
        isLoading={statsLoading}
        items={[
          { icon: MessageSquare, value: stats?.total || 0, label: '전체', counter: '건' },
          { icon: ThumbsUp, value: stats?.positive || 0, label: '긍정적', counter: '건', colorIndex: 1 },
          { icon: ThumbsDown, value: stats?.negative || 0, label: '부정적', counter: '건', colorIndex: 2 },
        ]}
      />

      <ShortcutGrid shortcuts={shortcuts} className="bg-white rounded-2xl shadow-v3 p-4" />

      <ListPanel data-component="mobile_admin_feedback_split-layout_list-panel"
        title="피드백 목록"
        tabs={filterItems}
        activeTab={filterType}
        onTabChange={(v) => setFilterType(v as FilterType)}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="사용자, 코멘트 검색..."
      >
        {!feedbackLoading && filteredList.length === 0 ? (
          <ListEmptyState message={searchQuery ? '검색 결과가 없습니다' : '피드백이 없습니다'} />
        ) : (
          <AnimatedSlotList<FeedbackItem>
            items={filteredList}
            isLoading={feedbackLoading}
            loadingCount={5}
            className="space-y-2"
            slotClassName={({ isLoading: slotLoading }) =>
              cn(
                'flex items-center gap-3 p-3 rounded-2xl transition-all duration-200 bg-white border-2 border-transparent',
                !slotLoading && 'cursor-pointer hover:bg-v3-primary-light/50 hover:border-v3-primary/30'
              )
            }
            onSlotClick={(feedback) => router.push(`/admin/feedback/${feedback.id}`)}
            render={({ item: feedback, isLoading: slotLoading }) => {
              if (slotLoading) {
                return (
                  <>
                    <div data-component="admin-feedback-item-skeleton-icon" className="w-9 h-9 rounded-2xl shrink-0 bg-v3-dim-white flex items-center justify-center">
                      <Skeleton className="w-4 h-4 rounded-2xl bg-white/70" />
                    </div>
                    <div data-component="admin-feedback-item-skeleton-content" className="flex-1 min-w-0">
                      <Skeleton className="h-4 w-24 mb-1.5 bg-v3-dim-white" />
                      <Skeleton className="h-3 w-32 bg-v3-dim-white" />
                    </div>
                    <Skeleton className="h-3 w-12 bg-v3-dim-white shrink-0" />
                  </>
                );
              }

              if (!feedback) return null;

              return (
                <>
                  <div data-component="admin-feedback-item-icon" className={cn(
                    'w-9 h-9 rounded-2xl flex items-center justify-center shrink-0',
                    feedback.type === 'positive' ? 'bg-emerald-50' : 'bg-red-50'
                  )}>
                    {feedback.type === 'positive'
                      ? <ThumbsUp className="w-4 h-4 text-emerald-500" />
                      : <ThumbsDown className="w-4 h-4 text-red-500" />
                    }
                  </div>
                  <div data-component="admin-feedback-item-content" className="flex-1 min-w-0">
                    <p className="text-[0.8rem] font-semibold text-v3-dark truncate">
                      {feedback.user.name || feedback.user.email || '익명'}
                    </p>
                    <p className="text-[0.7rem] text-v3-text-muted truncate">
                      {truncateText(feedback.comment, 30)}
                    </p>
                  </div>
                  <span className="text-[0.65rem] text-v3-text-muted whitespace-nowrap">
                    {formatDate(feedback.createdAt)}
                  </span>
                </>
              );
            }}
          />
        )}
      </ListPanel>
    </section>
  );
}
