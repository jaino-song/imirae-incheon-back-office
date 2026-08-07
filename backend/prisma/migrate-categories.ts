import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_CATEGORIES = [
    { value: "contract", label: "계약서", color: "primary", isCustom: false },
    { value: "invoice", label: "청구서", color: "secondary", isCustom: false },
    { value: "receipt", label: "영수증", color: "success", isCustom: false },
    { value: "report", label: "보고서", color: "info", isCustom: false },
    { value: "certificate", label: "증명서", color: "warning", isCustom: false },
    { value: "form", label: "양식", color: "default", isCustom: false },
    { value: "notice", label: "안내문", color: "error", isCustom: false },
    { value: "employee-contract", label: "제공인력 계약서", color: "primary", isCustom: false },
];

async function seedCategories(): Promise<Map<string, string>> {
    console.log("Seeding default categories...");
    const categoryMap = new Map<string, string>();

    for (const category of DEFAULT_CATEGORIES) {
        // Seed rows are global (branchId: null). `value` is no longer globally
        // unique — uniqueness is (branchId, value) plus a partial unique index on
        // value WHERE branch_id IS NULL — and Prisma cannot address a composite
        // unique containing NULL, so upsert-by-value is replaced with an explicit
        // find-then-update/create against the global scope.
        const existing = await prisma.document_category.findFirst({
            where: { value: category.value, branchId: null },
            select: { id: true },
        });
        const result = existing
            ? await prisma.document_category.update({
                  where: { id: existing.id },
                  data: {
                      label: category.label,
                      color: category.color,
                      isCustom: category.isCustom,
                  },
              })
            : await prisma.document_category.create({
                  data: {
                      value: category.value,
                      label: category.label,
                      color: category.color,
                      isCustom: category.isCustom,
                      branchId: null,
                  },
              });
        categoryMap.set(category.value, result.id);
        console.log(`  ✓ ${category.value} (${category.label}) -> ${result.id}`);
    }
    
    return categoryMap;
}

async function checkColumnExists(tableName: string, columnName: string): Promise<boolean> {
    const result = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = ${tableName} AND column_name = ${columnName}
    `;
    return result.length > 0;
}

async function migrateDocuments(categoryMap: Map<string, string>): Promise<void> {
    console.log("Migrating existing documents...");
    const documents = await prisma.$queryRaw<{ id: string; category: string }[]>`
        SELECT id, category FROM document
    `;
    
    console.log(`  Found ${documents.length} documents to migrate`);
    
    for (const doc of documents) {
        let categoryId: string | undefined = categoryMap.get(doc.category);
        
        if (!categoryId) {
            console.log(`  Creating custom category: ${doc.category}`);
            const newCategory = await (prisma as any).document_category.create({
                data: {
                    value: doc.category,
                    label: doc.category,
                    color: "default",
                    isCustom: true,
                },
            });
            categoryId = newCategory.id as string;
            categoryMap.set(doc.category, categoryId);
        }
        
        const finalCategoryId = categoryId;
        await prisma.$executeRaw`
            UPDATE document SET categoryId = ${finalCategoryId} WHERE id = ${doc.id}
        `;
        console.log(`  ✓ Migrated document ${doc.id}: ${doc.category} -> ${categoryId}`);
    }
}

async function main() {
    console.log("Starting category migration...\n");

    const categoryMap = await seedCategories();

    console.log("\nChecking current schema...");
    const hasOldCategoryColumn = await checkColumnExists("document", "category");
    const hasCategoryIdColumn = await checkColumnExists("document", "categoryId");
    
    console.log(`  Old 'category' column exists: ${hasOldCategoryColumn}`);
    console.log(`  New 'categoryId' column exists: ${hasCategoryIdColumn}`);

    if (hasOldCategoryColumn && !hasCategoryIdColumn) {
        console.log("\nAdding categoryId column...");
        await prisma.$executeRaw`ALTER TABLE document ADD COLUMN categoryId TEXT`;
        console.log("  ✓ Added categoryId column");

        await migrateDocuments(categoryMap);

        console.log("\nAdding constraints...");
        await prisma.$executeRaw`ALTER TABLE document ALTER COLUMN categoryId SET NOT NULL`;
        console.log("  ✓ Made categoryId NOT NULL");

        await prisma.$executeRaw`
            ALTER TABLE document 
            ADD CONSTRAINT document_category_id_fkey 
            FOREIGN KEY (categoryId) REFERENCES document_category(id)
        `;
        console.log("  ✓ Added foreign key constraint");

        console.log("\nDropping old category column...");
        await prisma.$executeRaw`DROP INDEX IF EXISTS document_category_idx`;
        await prisma.$executeRaw`ALTER TABLE document DROP COLUMN category`;
        console.log("  ✓ Dropped old category column");

        console.log("\nAdding index on categoryId...");
        await prisma.$executeRaw`CREATE INDEX document_category_id_idx ON document(categoryId)`;
        console.log("  ✓ Added index");

    } else if (hasCategoryIdColumn) {
        console.log("\nMigration already completed (categoryId column exists)");
    } else {
        console.log("\nNo documents table or unexpected schema state");
    }

    console.log("\n✅ Migration complete!");
}

main()
    .catch((e) => {
        console.error("Migration failed:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
