# BabyJamJam Admin – Backend

NestJS service powering the BabyJamJam Admin operations platform. The project follows **Clean Architecture** principles with clear separation of concerns across domain, application, infrastructure, and interface layers.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
  - [Clean Architecture Layers](#clean-architecture-layers)
  - [Dependency Flow](#dependency-flow)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Database (Prisma)](#database-prisma)
  - [Schema Overview](#schema-overview)
  - [Repository Pattern](#repository-pattern)
  - [Mapper Pattern](#mapper-pattern)
- [Testing Strategy](#testing-strategy)
  - [TDD Principles](#tdd-principles)
  - [Test Structure](#test-structure)
  - [Running Tests](#running-tests)
- [Feature Modules & Routes](#feature-modules--routes)
- [Authentication](#authentication)
- [Conventions](#conventions)
- [eformsign Mirror Operations](#eformsign-mirror-operations)
- [Useful Commands](#useful-commands)

---

## Architecture Overview

### Clean Architecture Layers

This project implements a **Clean Architecture** (also known as Hexagonal/Onion Architecture) with four distinct layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERFACE                                │
│  Controllers, DTOs (Request/Response validation)                 │
├─────────────────────────────────────────────────────────────────┤
│                       APPLICATION                                │
│  Services, Use Cases (Business logic orchestration)              │
├─────────────────────────────────────────────────────────────────┤
│                          DOMAIN                                  │
│  Entities, Value Objects, Repository Interfaces (Core business)  │
├─────────────────────────────────────────────────────────────────┤
│                      INFRASTRUCTURE                              │
│  Prisma Repositories, Auth Strategies, External APIs             │
└─────────────────────────────────────────────────────────────────┘
```

#### 1. Domain Layer (`domain/`)

The innermost layer containing pure business logic with **zero external dependencies**.

| Directory | Purpose |
|-----------|---------|
| `entities/` | Core business objects (e.g., `ClientEntity`, `EmployeeEntity`) with behavior |
| `value-objects/` | Immutable objects representing concepts (e.g., `Email`, `Money`, `PhoneNumber`) |
| `repositories/` | **Interfaces only** – contracts that infrastructure must implement |

```typescript
// Example: domain/entities/client.entity.ts
export class ClientEntity {
    constructor(
        public id: number,
        public name: string,
        public birthday: string | null,
        // ... other properties
    ) {}

    isGoingToCareCenter(): boolean {
        return this.careCenter;
    }

    static create(props: CreateClientProps): ClientEntity { ... }
    update(props: UpdateClientProps): void { ... }
}
```

#### 2. Application Layer (`application/`)

Orchestrates business logic through **Use Cases** and **Services**.

| Directory | Purpose |
|-----------|---------|
| `usecases/` | Single-responsibility commands/queries (e.g., `CreateClientUsecase`, `ListClientsPaginatedUsecase`) |
| `services/` | Facades that coordinate multiple use cases for a feature |
| `dto/` | Application-level data transfer objects |

```typescript
// Example: application/usecases/client/create-client.usecase.ts
@Injectable()
export class CreateClientUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async execute(params: CreateClientParams): Promise<ClientEntity> {
        const client = ClientEntity.create(params);
        return this.clientRepository.create(client);
    }
}
```

#### 3. Infrastructure Layer (`infrastructure/`)

Implements interfaces defined in the domain layer and handles external concerns.

| Directory | Purpose |
|-----------|---------|
| `database/repositories/` | Prisma implementations of repository interfaces |
| `database/mapper/` | Transform Prisma rows ↔ Domain entities |
| `database/prisma.service.ts` | Prisma client wrapper as NestJS service |
| `auth/` | JWT guards, Passport strategies (Kakao OAuth) |
| `api/` | External API clients (e.g., eformsign) |

```typescript
// Example: infrastructure/database/repositories/sb.client.repository.ts
@Injectable()
export class SbClientRepository implements IClientRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(id: number): Promise<ClientEntity | null> {
        const row = await this.prismaService.client.findUnique({ where: { id } });
        return row ? ClientMapper.toDomain(row) : null;
    }

    async findAllPaginated(page: number, limit: number, search?: string): Promise<PaginatedResult<ClientEntity>> {
        // Pagination with search across name, address, phone
    }
}
```

#### 4. Interface Layer (`interface/`)

Handles HTTP requests and responses.

| Directory | Purpose |
|-----------|---------|
| `controllers/` | REST API endpoints with route definitions |
| `dto/` | Request/response validation using `class-validator` |

```typescript
// Example: interface/controllers/client.controller.ts
@Controller("clients")
@UseGuards(JwtGuard)
export class ClientController {
    constructor(private readonly clientService: ClientService) {}

    @Post()
    create(@Body() dto: CreateClientDto) {
        return this.clientService.create({ ...dto });
    }

    @Get()
    findAll(@Query("page") page?: string, @Query("limit") limit?: string) {
        if (page && limit) {
            return this.clientService.findAllPaginated(Number(page), Number(limit));
        }
        return this.clientService.findAll();
    }
}
```

### Dependency Flow

```
Interface → Application → Domain ← Infrastructure
              ↓              ↑
         Uses Domain    Implements Domain
         Interfaces     Interfaces
```

- **Domain** has no dependencies (pure TypeScript)
- **Application** depends only on Domain
- **Infrastructure** implements Domain interfaces
- **Interface** depends on Application services
- **Dependency Injection** wires everything together via NestJS modules

---

## Project Structure

```
backend/
├── main.ts                    # Application bootstrap
├── app.module.ts              # Root module
│
├── domain/                    # 🏛️ DOMAIN LAYER
│   ├── entities/              # Business entities
│   │   ├── client.entity.ts
│   │   ├── employee.entity.ts
│   │   ├── user.entity.ts
│   │   └── ...
│   ├── value-objects/         # Immutable value types
│   │   ├── email.vo.ts
│   │   ├── money.vo.ts
│   │   └── phone-number.vo.ts
│   └── repositories/          # Repository interfaces (contracts)
│       ├── client.repository.interface.ts
│       ├── employee.repository.interface.ts
│       └── ...
│
├── application/               # 📋 APPLICATION LAYER
│   ├── usecases/              # Single-responsibility use cases
│   │   ├── client/
│   │   │   ├── create-client.usecase.ts
│   │   │   ├── list-clients-paginated.usecase.ts
│   │   │   └── index.ts
│   │   ├── employee/
│   │   └── ...
│   ├── services/              # Feature orchestrators
│   │   ├── client.service.ts
│   │   ├── employee.service.ts
│   │   └── ...
│   └── dto/                   # Application DTOs
│
├── infrastructure/            # 🔧 INFRASTRUCTURE LAYER
│   ├── database/
│   │   ├── prisma.service.ts  # Prisma client wrapper
│   │   ├── repositories/      # Interface implementations
│   │   │   ├── sb.client.repository.ts
│   │   │   └── ...
│   │   └── mapper/            # Entity ↔ Prisma row mappers
│   │       ├── client.mapper.ts
│   │       └── ...
│   ├── auth/                  # Authentication
│   │   ├── jwt.guard.ts
│   │   ├── jwt.strategy.ts
│   │   └── kakao.strategy.ts
│   └── api/                   # External API clients
│       └── eformsign-api.client.ts
│
├── interface/                 # 🌐 INTERFACE LAYER
│   ├── controllers/           # REST endpoints
│   │   ├── client.controller.ts
│   │   ├── employee.controller.ts
│   │   └── ...
│   └── dto/                   # Request/Response DTOs
│       ├── client.dto.ts
│       └── ...
│
├── module/                    # 📦 NestJS Feature Modules
│   ├── client.module.ts
│   ├── employee.module.ts
│   └── ...
│
├── prisma/                    # 🗄️ Database Schema
│   └── schema.prisma
│
└── test/                      # 🧪 Unit Tests
    └── repositories/
        ├── sb.client.repository.spec.ts
        └── ...
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- npm or yarn

### Installation

```bash
# 1. Install dependencies
cd backend
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your database URL, JWT secret, Kakao credentials, etc.

# 3. Generate Prisma client
npx prisma generate

# 4. Run database migrations
npx prisma migrate dev

# 5. Start development server
npm run start:dev
```

The API listens on port 3000 by default.

---

## Database (Prisma)

### Schema Overview

The database uses **PostgreSQL** with Prisma ORM. Key models:

| Model | Description |
|-------|-------------|
| `user` | User accounts with Kakao OAuth integration |
| `client` | Customer records with service details, assigned employees |
| `employee` | Service providers with availability status |
| `employee_schedule` | Work schedules linking employees to clients |
| `voucherPriceInfo` | Voucher pricing tiers |
| `bankAccountInfo` | Regional bank account details |
| `message` | Notice board messages |
| `eformsign_doc` | E-signature document tracking |

### Repository Pattern

Each domain entity has:

1. **Interface** in `domain/repositories/` – defines the contract
2. **Implementation** in `infrastructure/database/repositories/` – Prisma-based

```typescript
// domain/repositories/client.repository.interface.ts
export const CLIENT_REPOSITORY = Symbol("CLIENT_REPOSITORY");

export interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface IClientRepository {
    findById(id: number): Promise<ClientEntity | null>;
    findAll(): Promise<ClientEntity[]>;
    findAllPaginated(page: number, limit: number, search?: string): Promise<PaginatedResult<ClientEntity>>;
    create(client: ClientEntity): Promise<ClientEntity>;
    update(client: ClientEntity): Promise<ClientEntity>;
    delete(id: number): Promise<void>;
}
```

Repositories are injected using NestJS DI with symbol tokens:

```typescript
// module/client.module.ts
@Module({
    providers: [
        { provide: CLIENT_REPOSITORY, useClass: SbClientRepository },
        // ...
    ],
})
export class ClientModule {}
```

### Mapper Pattern

Mappers transform between Prisma database rows and domain entities:

```typescript
// infrastructure/database/mapper/client.mapper.ts
export class ClientMapper {
    static toDomain(row: ClientRow): ClientEntity {
        return new ClientEntity(
            row.id,
            row.name,
            row.primary_employee_id,  // snake_case → camelCase
            // ...
        );
    }

    static toPrismaCreate(entity: ClientEntity): Prisma.clientCreateInput {
        return {
            name: entity.name,
            primary_employee_id: entity.primaryEmployeeId,  // camelCase → snake_case
            // ...
        };
    }
}
```

---

## Testing Strategy

### TDD Principles

Tests follow **Test-Driven Development** best practices:

1. **AAA Pattern** – Arrange, Act, Assert with clear separation
2. **Given-When-Then** naming – Descriptive test names
3. **Fixture Factories** – Reusable test data creation
4. **Test Isolation** – Fresh mocks for each test
5. **Edge Cases** – Coverage for null values, empty results, pagination boundaries

### Test Structure

```
test/
└── repositories/
    ├── sb.client.repository.spec.ts
    ├── sb.employee.repository.spec.ts
    ├── sb.user.repository.spec.ts
    ├── sb.message.repository.spec.ts
    ├── sb.bank-account-info.repository.spec.ts
    └── sb.voucher-price-info.repository.spec.ts
```

Example test structure:

```typescript
describe("SbClientRepository", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================
    const createMockPrismaClient = () => ({
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    });

    const createClientRow = (overrides = {}) => ({
        id: 1,
        name: "John Doe",
        // ... defaults
        ...overrides,
    });

    let clientModel: ReturnType<typeof createMockPrismaClient>;
    let repository: SbClientRepository;

    beforeEach(() => {
        clientModel = createMockPrismaClient();
        prisma = { client: clientModel } as unknown as PrismaService;
        repository = new SbClientRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        describe("given a valid client id exists", () => {
            it("should return the mapped ClientEntity", async () => {
                // Arrange
                const row = createClientRow();
                clientModel.findUnique.mockResolvedValue(row);

                // Act
                const result = await repository.findById(1);

                // Assert
                expect(clientModel.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
                expect(result).toBeInstanceOf(ClientEntity);
            });
        });
    });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:cov
```

### Jest Configuration

Jest is configured with path aliases matching the clean architecture layers:

```typescript
// jest.config.ts
moduleNameMapper: {
    "^application/(.*)$": "<rootDir>/application/$1",
    "^domain/(.*)$": "<rootDir>/domain/$1",
    "^infrastructure/(.*)$": "<rootDir>/infrastructure/$1",
    "^interface/(.*)$": "<rootDir>/interface/$1",
},
```

---

## Feature Modules & Routes

| Module | Base Route | Description |
|--------|------------|-------------|
| **Auth** | `/auth` | Kakao OAuth login flow |
| **Users** | `/users` | User CRUD, role management |
| **Clients** | `/clients` | Client management with pagination & search |
| **Employees** | `/employees` | Employee directory with filters |
| **Employee Schedules** | `/employee-schedules` | Work schedule management |
| **Bank Account Info** | `/bank-account-infos` | Regional bank details |
| **Messages** | `/messages` | Notice board CRUD |
| **Voucher Price Info** | `/voucher-price-infos` | Pricing tier management |
| **Eformsign Docs** | `/eformsign-docs` | E-signature document tracking |
| **Eformsign** | `/eformsign` | eformsign API integration |

---

## Authentication

The API uses **JWT authentication** with **Kakao OAuth** for login.

### Flow

1. User initiates login via `/auth/kakao`
2. Kakao redirects back with authorization code
3. Backend exchanges code for Kakao access token
4. User is created/found in database
5. JWT is issued and set as HTTP-only cookie

### Guards

```typescript
// Protected route example
@Controller("clients")
@UseGuards(JwtGuard)  // Requires valid JWT
export class ClientController { ... }
```

### Configuration

Required environment variables:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public
DIRECT_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public
JWT_SECRET=your-secret-key
KAKAO_CLIENT_ID=your-kakao-app-id
KAKAO_CLIENT_SECRET=your-kakao-secret
KAKAO_CALLBACK_URL=http://localhost:3001/auth/kakao/callback
```

Create `backend/.env` from `backend/env.example` before running `npm run start:dev`.

---

## Conventions

### Code Branch

- **Domain logic** stays in entities/value objects – controllers remain thin
- **One use case = one file** – single responsibility
- **Services** orchestrate multiple use cases
- **DTOs** validated with `class-validator` decorators

### Naming

| Type | Convention | Example |
|------|------------|---------|
| Entity | `PascalCase + Entity` | `ClientEntity` |
| Use Case | `VerbNounUsecase` | `CreateClientUsecase` |
| Repository | `I + Entity + Repository` | `IClientRepository` |
| Mapper | `Entity + Mapper` | `ClientMapper` |
| Controller | `Entity + Controller` | `ClientController` |
| DTO | `Action + Entity + Dto` | `CreateClientDto` |

### Database

- Prisma schema uses `snake_case` for columns
- Domain entities use `camelCase` for properties
- Mappers handle the transformation

---

## eformsign Mirror Operations

The six-hour eformsign reconciliation scheduler requires a distributed Valkey lease.
If `VALKEY_URL` is unset, it fails closed and skips the sweep by default. A deployment
may set `EFORMSIGN_RECONCILE_ALLOW_UNLOCKED=true` only after confirming that exactly one
backend replica owns scheduled jobs; otherwise multiple replicas can duplicate the full
detail/PDF fetch and exhaust vendor limits. The default is unset/false.

Manual cutover backfills use the separate one-run approval
`EFORMSIGN_BACKFILL_ALLOW_UNLOCKED=true` and the exact target confirmation described in
[ADR 004](../docs/adr/004-eformsign-local-source-of-truth.md).

---

## Useful Commands

```bash
# Development
npm run start:dev          # Start with hot reload

# Build
npm run build              # Compile to dist/
npm start                  # Run compiled output

# Database
npx prisma generate        # Regenerate Prisma client
npx prisma migrate dev     # Create and apply migrations
npx prisma studio          # Visual database browser
npx prisma db push         # Push schema changes (no migration)

# Testing
npm test                   # Run all tests
npm run test:watch         # Watch mode
npm run test:cov           # Generate coverage report

# Linting
npm run lint               # Run ESLint
npm run format             # Run Prettier
```

---

## License

Private – BabyJamJam
