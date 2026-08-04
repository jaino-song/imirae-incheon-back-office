import { Spinner } from "@/components/ui/spinner";

import styles from "./LegacyChatPage.module.css";

export function ChatPageLoading() {
  return (
    <section
      className={styles.chatShell}
      data-component="mobile_chat_agent-shell_loading"
      role="status"
      aria-live="polite"
    >
      <Spinner size="sm" />
    </section>
  );
}
