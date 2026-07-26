import { memo } from "react";
import { motion } from "framer-motion";
import { Copy } from "lucide-react";
import { HeaderActionButton } from "@/components/app/v3/HeaderActionButton";
import { MsgField } from "./MsgField";

interface GeneratedMsgProps {
  /** Caller-context canonical value for this node. */
  "data-component": string;

  title: string;
  copyButtonText: string;
  message: string;
  onMessageChange?: (value: string) => void;
  handleCopy: () => void;
}

export const GeneratedMsg = memo(function GeneratedMsg({
  "data-component": dataComponent,
  title,
  copyButtonText,
  message,
  onMessageChange,
  handleCopy,
}: GeneratedMsgProps) {
  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(10px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.8 }}
    >
      <div className="flex flex-row justify-between items-center mb-4">
        <h6 className="text-lg font-semibold text-primary">{title}</h6>
        <HeaderActionButton
          icon={Copy}
          label={copyButtonText}
          onClick={handleCopy}
          data-component={`${dataComponent}_copy`}
        />
      </div>
      <MsgField data-component={`${dataComponent}_field`} value={message} onChange={onMessageChange} />
    </motion.div>
  );
});
