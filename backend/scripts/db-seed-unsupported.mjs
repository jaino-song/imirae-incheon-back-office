const message = [
  "No general-purpose development database seed is supported.",
  "The legacy backend/prisma/seed.ts entrypoint is not maintained, so db:seed refuses to run.",
  "",
  "Supported alternatives (isolated test databases only):",
  "  pnpm --filter ./backend db:seed:e2e",
  "  pnpm --filter ./backend db:seed:auth-e2e",
].join("\n");

console.error(message);
process.exitCode = 1;
