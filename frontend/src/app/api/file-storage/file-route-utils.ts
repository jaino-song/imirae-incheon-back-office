import { NextResponse } from "next/server";

export function isValidFileId(fileId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(fileId);
}

export function invalidFileIdResponse(): NextResponse {
  return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
}

export function documentPath(fileId: string, suffix = ""): string {
  return `/documents/${encodeURIComponent(fileId)}${suffix}`;
}
