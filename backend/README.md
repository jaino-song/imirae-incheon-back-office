## Imirae Incheon Back Office – Backend

NestJS service that powers authentication, user administration, employees, client banking details, vouchers, and messaging for the Imirae Incheon back office. The project follows a clean architecture style (domain → application → infrastructure → interface) with injectable usecases and Prisma for persistence.

### Getting Started

1. **Install dependencies** (from `backend/`):

   ```bash
   npm install
   ```

2. **Environment variables** – copy your env template and set database/auth secrets:

   ```bash
   cp .env.example .env
   # edit values: DIRECT_URL, JWT_SECRET, Kakao credentials, etc.
   ```

3. **Database** – the repo uses Prisma. Update `prisma/schema.prisma` as needed then generate the client and run migrations:

   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

4. **Start the dev server**:

   ```bash
   npm run start:dev
   ```

   The API listens on the port configured in your NestJS bootstrap (default `3000`).

### Tests

Jest is configured with `ts-jest` and alias mapping for the clean-architecture folders.

```bash
npm test          # single run
npm run test:watch
```

### Project Structure

```
backend/
├── application/       # Usecases and services (business logic)
├── domain/            # Entities, value objects, repository interfaces
├── infrastructure/    # Prisma repositories, auth strategies, shared services
├── interface/         # Controllers, DTOs, filters, etc.
├── module/            # Feature modules wiring controllers/usecases/repos
├── prisma/            # Prisma schema & migrations
└── test/              # Jest unit tests
```

### Feature Modules & Routes

- **Auth** (`/auth`, `/eformsign`) – existing controllers for Kakao login and document integrations.
- **Users** (`/users`) – create, retrieve (by id/kakao id), update profile/role, delete.
- **Bank Account Info** (`/bank-account-infos`) – manage regional bank account entries.
- **Messages** (`/messages`) – CRUD notice board messages with edited timestamps.
- **Employees** (`/employees`) – full employee directory with filtering by area, grade, availability, registered date range, plus open-status toggling.
- **Voucher Price Info** (`/voucher-price-infos`) – manage voucher pricing by type with bigint durations.

Each controller consumes DTOs validated with `class-validator` and delegates to application services/usecases. Repositories adapt Prisma models to domain entities.

### Tooling Notes

- Uses `class-validator`/`class-transformer` for DTO validation.
- Prisma client is injected via `PrismaService` (extends `PrismaClient`).
- Feature modules export their service for reuse; `AppModule` only imports modules and global providers (JWT/auth).
- Jest tests mock Prisma models to validate repository behavior.

### Useful Commands

```bash
npm run build        # Compile to dist/
npm start            # Run compiled output
npx prisma studio    # Inspect database with Prisma Studio
```

### Conventions

- Keep domain logic inside entities/value objects/usecases; controllers stay thin.
- Prefer services that orchestrate multiple usecases for a feature.
- When extending Prisma schema, add matching mapper/repository logic and expose through a module.

For further questions, see the root README or open an issue in the repository.

