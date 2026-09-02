/**
 * Backend compatibility surface for the canonical shared Korean business-day
 * calendar. Keep imports in the domain layer stable while ensuring backend,
 * frontend/mobile, and eformsign all execute the same versioned source.
 */
export * from "@babyjamjam/shared/utils/business-days";
