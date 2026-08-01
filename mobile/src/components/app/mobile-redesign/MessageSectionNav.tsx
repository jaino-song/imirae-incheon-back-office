"use client";

import { useRouter } from "next/navigation";
import {
  Clock3,
  FileText,
  History,
  Send,
  Settings2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  MESSAGE_SECTION_DEFINITIONS,
  type MessageSectionId,
} from "@babyjamjam/shared";

import { MobileSectionNav } from "@/components/app/mobile-redesign/primitives";

const SOURCE_COMPONENT = "MessageSectionNav";

interface MessageNavigationItem {
  id: MessageSectionId;
  title: string;
  href: string;
  icon: LucideIcon;
}

const MESSAGE_NAVIGATION_PRESENTATION: Record<MessageSectionId, LucideIcon> = {
  send: Send,
  scheduled: Clock3,
  history: History,
  templates: FileText,
  triggers: Workflow,
  settings: Settings2,
};

export const MESSAGE_NAVIGATION_ITEMS: MessageNavigationItem[] =
  MESSAGE_SECTION_DEFINITIONS.map((section) => ({
    id: section.id,
    title: section.label,
    href: section.mobilePath,
    icon: MESSAGE_NAVIGATION_PRESENTATION[section.id],
  }));

const DISABLED_SECTION_IDS = new Set<MessageSectionId>([
  "scheduled",
  "history",
  "templates",
  "triggers",
]);

const MESSAGE_SECTION_NAV_ITEMS = MESSAGE_NAVIGATION_ITEMS.map((item) => ({
  id: item.id,
  label: item.title,
  icon: item.icon,
  disabled: DISABLED_SECTION_IDS.has(item.id),
}));

export function MessageSectionNav({
  "data-component": dataComponent,
  activeId,
}: {
  "data-component": string;
  activeId: MessageSectionId;
}) {
  const router = useRouter();

  const handleSectionSelect = (sectionId: MessageSectionId) => {
    const selectedItem = MESSAGE_NAVIGATION_ITEMS.find((item) => item.id === sectionId);
    if (selectedItem) router.push(selectedItem.href);
  };

  return (
    <MobileSectionNav
      data-component={dataComponent}
      sourceComponent={SOURCE_COMPONENT}
      ariaLabel="메시지 기능"
      items={MESSAGE_SECTION_NAV_ITEMS}
      activeId={activeId}
      onSelect={handleSectionSelect}
    />
  );
}
