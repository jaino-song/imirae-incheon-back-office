"use client";

import { useMemo } from "react";
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
import { useInitialUser } from "@/providers/UserProvider";

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

// Sections that are still 출시 예정. The owner gets early access to them; everyone
// else sees them disabled until the features ship.
const UNRELEASED_SECTION_IDS = new Set<MessageSectionId>([
  "scheduled",
  "history",
  "templates",
  "triggers",
]);

export function MessageSectionNav({
  "data-component": dataComponent,
  activeId,
}: {
  "data-component": string;
  activeId: MessageSectionId;
}) {
  const router = useRouter();
  const user = useInitialUser();
  const isOwner = user?.role === "owner";

  const sectionNavItems = useMemo(
    () =>
      MESSAGE_NAVIGATION_ITEMS.map((item) => ({
        id: item.id,
        label: item.title,
        icon: item.icon,
        disabled: UNRELEASED_SECTION_IDS.has(item.id) && !isOwner,
      })),
    [isOwner],
  );

  const handleSectionSelect = (sectionId: MessageSectionId) => {
    const selectedItem = MESSAGE_NAVIGATION_ITEMS.find((item) => item.id === sectionId);
    if (selectedItem) router.push(selectedItem.href);
  };

  return (
    <MobileSectionNav
      data-component={dataComponent}
      sourceComponent={SOURCE_COMPONENT}
      ariaLabel="메시지 기능"
      items={sectionNavItems}
      activeId={activeId}
      onSelect={handleSectionSelect}
    />
  );
}
