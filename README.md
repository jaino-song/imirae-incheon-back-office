# Imirae Incheon Back Office Monorepo

This repository hosts the back-office platform using a Nest.js API and a Next.js frontend within a single monorepo managed by the Nest CLI.

## Project Structure

```
apps/
  api/         Nest.js HTTP API (monorepo managed by Nest CLI)
  frontend/    Next.js application
libs/
  shared-types/  Shared TypeScript definitions that can be imported from both apps
```

## Getting Started

Install dependencies (requires access to the public npm registry):

```bash
npm install
```

Copy the environment examples and adjust the values to match your local configuration:

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/frontend/.env.example apps/frontend/.env.local
```

### Available Scripts

| Command | Description |
| ------- | ----------- |
| `npm run dev:frontend` | Start the Next.js development server. |
| `npm run dev:api` | Start the Nest.js API in watch mode. |
| `npm run build:frontend` | Build the frontend application. |
| `npm run build:api` | Compile the API. |
| `npm run build:shared-types` | Build the shared types library. |
| `npm run start:frontend` | Run the compiled frontend in production mode. |
| `npm run start:api` | Start the compiled API server. |
| `npm run lint` | Lint the entire monorepo. |
| `npm run lint:fix` | Lint and automatically fix issues where possible. |
| `npm run format` | Format supported files with Prettier. |
| `npm run test:api` | Execute API end-to-end tests using Jest. |

Husky and lint-staged are configured to run `eslint --fix` and `prettier --write` on staged files before committing.

## Continuous Integration

The GitHub Actions workflow in `.github/workflows/ci.yml` installs dependencies, lints the codebase, and builds the shared library, API, and frontend to validate pull requests.

## Sharing Code Between Apps

Reusable DTOs and types live in `libs/shared-types`. Import them with the `@shared-types` path alias from either application:

```ts
import { defaultWelcomeMessage } from "@shared-types";
```

## Environment Variables

- `.env` (optional) – shared defaults for the entire monorepo.
- `apps/api/.env` – runtime configuration for the API server (e.g., `PORT`).
- `apps/frontend/.env.local` – frontend-specific environment values (e.g., `NEXT_PUBLIC_API_URL`).

Each application loads environment files relative to its directory, ensuring local development and CI environments stay isolated.
