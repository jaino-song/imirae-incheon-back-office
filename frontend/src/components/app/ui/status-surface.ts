import type { StatusBadgeVariant } from "@babyjamjam/shared/tokens/status-badge";

/**
 * The one place a status colour is spelled out. Each entry pairs a tinted
 * surface with the line and text colour that belong to it, so everything that
 * signals state — StatusBadge, Toaster — reads as the same design language.
 *
 * The colour values themselves live in globals.css as the --status-* tokens;
 * these are only the utility triples that reference them.
 *
 * The variant names come from @babyjamjam/shared, which decides which domain
 * status is which variant ("preBooking is neutral"); this file decides what a
 * variant looks like. Satisfying Record<StatusBadgeVariant, string> keeps the
 * two layers in step — add a variant there and this stops compiling until it
 * has a surface here. Tailwind classes can't move into the shared package: it
 * is framework-free and the two apps size their components differently.
 */
export const STATUS_SURFACE = {
  neutral: "bg-status-neutral border-status-neutral-line text-status-neutral-fg",
  info: "bg-status-info border-status-info-line text-status-info-fg",
  // shared keeps "primary" and "info" as separate names because callers speak
  // in domain terms, but they have always rendered the same.
  primary: "bg-status-info border-status-info-line text-status-info-fg",
  success: "bg-status-success border-status-success-line text-status-success-fg",
  warning: "bg-status-warning border-status-warning-line text-status-warning-fg",
  danger: "bg-status-danger border-status-danger-line text-status-danger-fg",
} as const satisfies Record<StatusBadgeVariant, string>;
