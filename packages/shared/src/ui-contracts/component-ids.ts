export const DATA_COMPONENT_ID_PATTERN =
  /^(desktop|mobile)_[a-z0-9]+(?:-[a-z0-9]+)*(?:_[a-z0-9]+(?:-[a-z0-9]+)*){1,}$/;

export type DataComponentPlatform = "desktop" | "mobile";

const DATA_COMPONENT_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertSegments(parts: readonly string[]): void {
  if (parts.length === 0 || parts.some((part) => !DATA_COMPONENT_SEGMENT_PATTERN.test(part))) {
    throw new Error(`Invalid data-component path segments: ${parts.join(", ")}`);
  }
}

export function makeDataComponentId(
  platform: DataComponentPlatform,
  ...parts: string[]
): string {
  assertSegments(parts);
  return [platform, ...parts].join("_");
}

export function extendDataComponentId(parent: string, ...parts: string[]): string {
  if (!isValidDataComponentId(parent)) {
    throw new Error(`Invalid data-component parent: ${parent}`);
  }
  assertSegments(parts);
  return [parent, ...parts].join("_");
}

export function isValidDataComponentId(id: string): boolean {
  return DATA_COMPONENT_ID_PATTERN.test(id);
}

export function isDataComponentDescendant(parent: string, child: string): boolean {
  return child.startsWith(`${parent}_`) && isValidDataComponentId(child);
}
