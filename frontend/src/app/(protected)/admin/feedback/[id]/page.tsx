'use client';

import { useQuery } from '@tanstack/react-query';
import { getFeedbackDetail, SessionMessage } from '@/lib/api/admin';
import { useRouter, useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function FeedbackDetailPage() {
  const router = useRouter();
  const params = useParams();
  const feedbackId = params.id as string;

  const { data: feedback, isLoading, error } = useQuery({
    queryKey: ['feedbackDetail', feedbackId],
    queryFn: () => getFeedbackDetail(feedbackId),
  });

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

  if (isLoading) {
    return (
      <div data-component="desktop_admin-feedback_detail_loading" className="min-h-screen bg-muted/50 p-8">
        <div data-component="desktop_admin-feedback_detail_loading_content" className="max-w-4xl mx-auto">
          <div data-component="desktop_admin-feedback_detail_loading_content_skeleton" className="animate-pulse">
            <div data-component="desktop_admin-feedback_detail_loading_content_skeleton_heading" className="skeleton-base h-8 rounded w-32 mb-8"></div>
            <div data-component="desktop_admin-feedback_detail_loading_content_skeleton_card" className="bg-card rounded-lg shadow p-6 mb-6">
              <div data-component="desktop_admin-feedback_detail_loading_content_skeleton_card_title" className="skeleton-base h-6 rounded w-48 mb-4"></div>
              <div data-component="desktop_admin-feedback_detail_loading_content_skeleton_card_lines" className="space-y-3">
                <div data-component="desktop_admin-feedback_detail_loading_content_skeleton_card_lines_line" className="skeleton-base h-4 rounded w-full"></div>
                <div data-component="desktop_admin-feedback_detail_loading_content_skeleton_card_lines_line" className="skeleton-base h-4 rounded w-3/4"></div>
                <div data-component="desktop_admin-feedback_detail_loading_content_skeleton_card_lines_line" className="skeleton-base h-4 rounded w-5/6"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !feedback) {
    return (
      <div data-component="desktop_admin-feedback_detail_error" className="min-h-screen bg-muted/50 p-8">
        <div data-component="desktop_admin-feedback_detail_error_content" className="max-w-4xl mx-auto">
          <button
            type="button"
            onClick={() => router.push('/admin')}
            className="mb-8 text-primary hover:text-primary/80 font-medium flex items-center gap-2"
          >
            ←
          </button>
          <div data-component="desktop_admin-feedback_detail_error_content_panel" className="bg-card rounded-lg shadow p-12 text-center">
            <p className="text-destructive text-lg font-medium mb-2">피드백을 찾을 수 없습니다</p>
            <p className="text-muted-foreground">요청하신 피드백이 존재하지 않거나 삭제되었습니다.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-component="desktop_admin-feedback_detail" className="min-h-screen bg-muted/50 p-8">
      <div data-component="desktop_admin-feedback_detail_content" className="max-w-4xl mx-auto">
        <button
          type="button"
          onClick={() => router.push('/admin')}
          data-component="desktop_admin-feedback_detail_content_back"
          className="mb-8 text-primary hover:text-primary/80 font-medium flex items-center gap-2 transition-colors"
        >
          ←
        </button>

        <div data-component="desktop_admin-feedback_detail_content_info" className="bg-card rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold text-foreground mb-4">피드백 정보</h2>
          <div data-component="desktop_admin-feedback_detail_content_info_grid" className="space-y-3">
            <div data-component="desktop_admin-feedback_detail_content_info_grid_type" className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground w-24">유형:</span>
              <span className="flex items-center gap-2">
                <span className="text-2xl">{feedback.type === 'positive' ? '👍' : '👎'}</span>
                <span className="font-medium text-foreground">
                  {feedback.type === 'positive' ? '긍정적' : '부정적'}
                </span>
              </span>
            </div>
            <div data-component="desktop_admin-feedback_detail_content_info_grid_user" className="flex items-start gap-3">
              <span className="text-sm font-medium text-muted-foreground w-24">사용자:</span>
              <div data-component="desktop_admin-feedback_detail_content_info_grid_user_body">
                <p className="font-medium text-foreground">
                  {feedback.user.name || '익명'}
                </p>
                {feedback.user.email && (
                  <p className="text-sm text-muted-foreground">{feedback.user.email}</p>
                )}
              </div>
            </div>
            <div data-component="desktop_admin-feedback_detail_content_info_grid_date" className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground w-24">날짜:</span>
              <span className="text-foreground">{formatDate(feedback.createdAt)}</span>
            </div>
            {feedback.comment && (
              <div data-component="desktop_admin-feedback_detail_content_info_grid_comment" className="flex items-start gap-3">
                <span className="text-sm font-medium text-muted-foreground w-24">코멘트:</span>
                <p className="text-foreground flex-1">{feedback.comment}</p>
              </div>
            )}
          </div>
        </div>

        <div data-component="desktop_admin-feedback_detail_content_chat" className="bg-card rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-foreground mb-6">대화 내역</h2>
          <div data-component="desktop_admin-feedback_detail_content_chat_list" className="space-y-4">
            {feedback.session.messages.map((message: SessionMessage) => {
              const isHighlighted = message.id === feedback.message.id;
              const isUser = message.role === 'user';

              return (
                <div
                  data-component="desktop_admin-feedback_detail_content_chat_list_row"
                  key={message.id}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    data-component="desktop_admin-feedback_detail_content_chat_list_row_bubble"
                    className={`max-w-[80%] rounded-lg p-4 ${isHighlighted
                        ? 'ring-2 ring-warning bg-warning/10'
                        : isUser
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground'
                      }`}
                  >
                    <div data-component="desktop_admin-feedback_detail_content_chat_list_row_bubble_meta" className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-medium ${isHighlighted
                          ? 'text-warning'
                          : isUser
                            ? 'text-primary-foreground/80'
                            : 'text-muted-foreground'
                        }`}>
                        {isUser ? '사용자' : 'AI 어시스턴트'}
                      </span>
                      <span className={`text-xs ${isHighlighted
                          ? 'text-warning/80'
                          : isUser
                            ? 'text-primary-foreground/60'
                            : 'text-muted-foreground/80'
                        }`}>
                        {formatDate(message.timestamp)}
                      </span>
                      {isHighlighted && (
                        <span className="text-xs font-bold text-warning ml-auto">
                          ⭐ 피드백 대상
                        </span>
                      )}
                    </div>
                    {isUser ? (
                      <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    ) : (
                      <div data-component="desktop_admin-feedback_detail_content_chat_list_row_bubble_content" className={`prose prose-sm max-w-none ${isHighlighted ? 'prose-yellow' : 'prose-neutral dark:prose-invert'
                         }`}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => (
                              <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>
                            ),
                            ul: ({ children }) => (
                              <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>
                            ),
                            li: ({ children }) => (
                              <li className="leading-relaxed">{children}</li>
                            ),
                            code: ({ className, children }) => {
                              const isInline = !className;
                              return isInline ? (
                                <code className="bg-muted text-foreground px-1.5 py-0.5 rounded text-sm font-mono">
                                  {children}
                                </code>
                              ) : (
                                <code className={className}>{children}</code>
                              );
                            },
                            pre: ({ children }) => (
                              <pre className="bg-card-foreground text-card p-4 rounded-lg overflow-x-auto mb-3">
                                {children}
                              </pre>
                            ),
                            h1: ({ children }) => (
                              <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0">{children}</h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h3>
                            ),
                            table: ({ children }) => (
                              <div data-component="desktop_admin-feedback_detail_content_chat_list_row_bubble_content_table" className="overflow-x-auto mb-3">
                                <table className="min-w-full border-collapse border border-border">
                                  {children}
                                </table>
                              </div>
                            ),
                            th: ({ children }) => (
                              <th className="border border-border bg-muted px-3 py-2 text-left font-semibold">
                                {children}
                              </th>
                            ),
                            td: ({ children }) => (
                              <td className="border border-border px-3 py-2">{children}</td>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="border-l-4 border-border pl-4 italic my-3 text-muted-foreground">
                                {children}
                              </blockquote>
                            ),
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                className="text-primary hover:underline"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {children}
                              </a>
                            ),
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
