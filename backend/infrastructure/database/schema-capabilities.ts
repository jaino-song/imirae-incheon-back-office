import { PrismaService } from "./prisma.service";

const columnCache = new Map<string, boolean>();
const tableCache = new Map<string, boolean>();

export type SchemaCapabilityClient = Pick<PrismaService, "$queryRawUnsafe">;

async function queryExists(prisma: SchemaCapabilityClient, sql: string, params: unknown[]): Promise<boolean> {
    const result = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(sql, ...params);
    return Boolean(result[0]?.exists);
}

export async function hasColumn(
    prisma: SchemaCapabilityClient,
    tableName: string,
    columnName: string,
): Promise<boolean> {
    const cacheKey = `${tableName}.${columnName}`;
    if (columnCache.has(cacheKey)) {
        return columnCache.get(cacheKey)!;
    }

    const exists = await queryExists(
        prisma,
        `SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2
        ) AS exists`,
        [tableName, columnName],
    );

    columnCache.set(cacheKey, exists);
    return exists;
}

export async function hasTable(prisma: SchemaCapabilityClient, tableName: string): Promise<boolean> {
    if (tableCache.has(tableName)) {
        return tableCache.get(tableName)!;
    }

    const exists = await queryExists(
        prisma,
        `SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = $1
        ) AS exists`,
        [tableName],
    );

    tableCache.set(tableName, exists);
    return exists;
}

export function clearSchemaCapabilityCache(): void {
    columnCache.clear();
    tableCache.clear();
}
