import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { ListCard } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";
import styles from "./page.module.css";

export default function NewMessageLoading() {
  return (
    <section
      data-component="mobile_messages_new_loading_page"
      data-slot="messages-new-loading-page"
      className={`messages-page ${styles.pageRoot}`}
    >
      <div data-component="mobile_messages_new_loading_screen" className={styles.phoneScreen}>
        <div
          data-component="mobile_messages_new_loading_form"
          className={`shell-content gap-[calc(8px*var(--glint-ui-scale,1))] ${styles.navPage}`}
        >
          <div data-component="mobile_messages_new_loading_section-nav" className="shrink-0">
            <MessageSectionNav
              data-component="mobile_messages_new_loading_section-nav_nav"
              activeId="send"
            />
          </div>

          <div data-component="mobile_messages_new_loading_scroll" className={styles.msgScroll}>
            <ListCard
              data-component="mobile_messages_new_loading_list-card"
              title="새 메시지"
              actionLabel="즉시 발송"
              actionIcon={null}
              actionType="button"
              actionDisabled
              filters={[]}
            >
              <div
                data-component="mobile_messages_new_loading_form-card"
                className={`${styles.recipientCard} pop-up`}
              >
                <div
                  data-component="mobile_messages_new_loading_form-card_content"
                  className={styles.unifiedFormCardContent}
                >
                  {/* Template Select Skeleton */}
                  <div className={styles.formCardSection}>
                    <div className={styles.formSection}>
                      <div className="h-4 w-20 rounded bg-v3-dim-white animate-pulse" />
                      <div className="h-10 w-full rounded-2xl bg-v3-dim-white animate-pulse" />
                    </div>
                  </div>

                  {/* Recipient Input Skeleton */}
                  <div className={styles.formCardSection}>
                    <div className={styles.formSection}>
                      <div className="h-4 w-24 rounded bg-v3-dim-white animate-pulse" />
                      <div className="h-10 w-full rounded-2xl bg-v3-dim-white animate-pulse" />
                    </div>
                  </div>

                  {/* Message Body Textarea Skeleton */}
                  <div className={styles.formCardSection}>
                    <div className={styles.formSection}>
                      <div className="h-4 w-20 rounded bg-v3-dim-white animate-pulse" />
                      <div className={`w-full rounded-2xl bg-v3-dim-white animate-pulse min-h-[40svh] ${styles.messageFieldTextarea}`} />
                    </div>
                  </div>
                </div>
              </div>
            </ListCard>
          </div>
        </div>
      </div>
    </section>
  );
}
