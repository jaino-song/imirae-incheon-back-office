import { PrismaClient } from "@prisma/client";

import { normalizePhone } from "../../domain/utils/normalize-phone";

const prisma = new PrismaClient();

const BRANCH_ID = "33dbe950-1574-4951-b7b4-92d97ab29512";
const USER_ID = "ac5f25d7-f8cc-4c68-82a5-db6dc2968c5f";
const USER_BRANCH_ID = "d3f5b0a3-7892-4715-96de-3db0d0f87f3a";
const AREA_ID = "namdong";
const CLIENT_ID = 1;

const now = new Date("2026-06-06T00:00:00.000Z");

const areaTemplates = [
    {
        id: "area-template-1",
        areaId: AREA_ID,
        templateId: "tpl-create-test",
        templateName: "남동구 계약서",
    },
    {
        id: "area-template-existing",
        areaId: AREA_ID,
        templateId: "tpl-existing-test",
        templateName: "남동구 계약서",
    },
    {
        id: "area-template-finalize",
        areaId: AREA_ID,
        templateId: "tpl-test",
        templateName: "남동구 계약서",
    },
] as const;

const eformsignDocs = [
    {
        documentId: "doc-create-test",
        createdDate: new Date("2026-05-01T09:00:00.000Z"),
        updatedDate: new Date("2026-05-01T09:00:00.000Z"),
        statusType: "060",
        statusDetail: "대기",
        stepType: "05",
        stepIndex: "2",
        stepName: "이용자 서명",
        stepRecipientType: "02",
        stepRecipientName: "홍테스트",
        stepRecipientSms: "01012345678",
        expiredDate: new Date("2026-06-30T09:00:00.000Z"),
        clientId: CLIENT_ID,
    },
    {
        documentId: "doc-finalize-test",
        createdDate: new Date("2026-06-01T09:00:00.000Z"),
        updatedDate: new Date("2026-06-02T09:00:00.000Z"),
        statusType: "060",
        statusDetail: "검토 필요",
        stepType: "05",
        stepIndex: "3",
        stepName: "이용자 서명",
        stepRecipientType: "01",
        stepRecipientName: "홍테스트",
        stepRecipientSms: "01012345678",
        expiredDate: new Date("2026-06-30T09:00:00.000Z"),
        clientId: CLIENT_ID,
    },
    {
        documentId: "doc-delete-target",
        createdDate: new Date("2026-06-03T09:00:00.000Z"),
        updatedDate: new Date("2026-06-03T09:00:00.000Z"),
        statusType: "002",
        statusDetail: "대기",
        stepType: "01",
        stepIndex: "1",
        stepName: "발송 대기",
        stepRecipientType: "02",
        stepRecipientName: "홍테스트",
        stepRecipientSms: "01012345678",
        expiredDate: new Date("2026-07-03T09:00:00.000Z"),
        clientId: CLIENT_ID,
    },
    {
        documentId: "doc-keep-1",
        createdDate: new Date("2026-06-02T09:00:00.000Z"),
        updatedDate: new Date("2026-06-02T09:00:00.000Z"),
        statusType: "002",
        statusDetail: "대기",
        stepType: "01",
        stepIndex: "1",
        stepName: "발송 대기",
        stepRecipientType: "02",
        stepRecipientName: "홍테스트",
        stepRecipientSms: "01012345678",
        expiredDate: new Date("2026-07-02T09:00:00.000Z"),
        clientId: CLIENT_ID,
    },
] as const;

const systemTemplates = [
    {
        id: "tpl-price",
        templateKey: "PRICE_INFO",
        content: "비용 안내 메시지: {{name}}",
    },
    {
        id: "tpl-greeting",
        templateKey: "GREETING",
        content: "안녕하세요!",
    },
    {
        id: "tpl-thanks",
        templateKey: "THANKS",
        content: "감사합니다 {{name}}님",
    },
    {
        id: "tpl-survey",
        templateKey: "SURVEY",
        content: "설문 부탁드립니다 {{name}}님",
    },
    {
        id: "tpl-service",
        templateKey: "SERVICE_INFO",
        content: "서비스 안내드립니다 {{name}}님",
    },
    {
        id: "tpl-reminder",
        templateKey: "REMINDER",
        content: "리마인더입니다 {{name}}님",
    },
    {
        id: "tpl-info",
        templateKey: "INFO",
        content: "안내드립니다",
    },
] as const;

async function upsertSystemTemplateVersion(
    templateId: string,
    content: string,
): Promise<void> {
    const existing = await prisma.system_template_version.findFirst({
        where: {
            templateId,
            versionNumber: 1,
        },
        select: { id: true },
    });

    if (existing) {
        await prisma.system_template_version.update({
            where: { id: existing.id },
            data: {
                content,
                createdBy: "e2e-seed",
            },
        });
        return;
    }

    await prisma.system_template_version.create({
        data: {
            templateId,
            content,
            versionNumber: 1,
            createdBy: "e2e-seed",
        },
    });
}

async function main(): Promise<void> {
    await prisma.user.upsert({
        where: { id: USER_ID },
        update: {
            email: "owner-e2e@babyjamjam.test",
            name: "E2E Owner",
            role: "owner",
        },
        create: {
            id: USER_ID,
            email: "owner-e2e@babyjamjam.test",
            name: "E2E Owner",
            role: "owner",
        },
    });

    await prisma.branch.upsert({
        where: { id: BRANCH_ID },
        update: {
            name: "인천 E2E점",
            slug: "e2e-namdong",
            region: "인천",
            district: "남동구",
            branchType: "direct",
            phone: "1661-2386",
            address: "인천 남동구 테스트로 123",
            ownerId: USER_ID,
            isActive: true,
            smsSenderApprovalStatus: "approved",
            smsSenderApprovalRequestedAt: now,
            smsSenderApprovalRequestedBy: USER_ID,
            smsSenderApprovalApprovedAt: now,
            smsSenderApprovalApprovedBy: USER_ID,
        },
        create: {
            id: BRANCH_ID,
            name: "인천 E2E점",
            slug: "e2e-namdong",
            region: "인천",
            district: "남동구",
            branchType: "direct",
            phone: "1661-2386",
            address: "인천 남동구 테스트로 123",
            ownerId: USER_ID,
            isActive: true,
            smsSenderApprovalStatus: "approved",
            smsSenderApprovalRequestedAt: now,
            smsSenderApprovalRequestedBy: USER_ID,
            smsSenderApprovalApprovedAt: now,
            smsSenderApprovalApprovedBy: USER_ID,
        },
    });

    await prisma.user_branch.upsert({
        where: { id: USER_BRANCH_ID },
        update: {
            userId: USER_ID,
            branchId: BRANCH_ID,
            role: "admin",
        },
        create: {
            id: USER_BRANCH_ID,
            userId: USER_ID,
            branchId: BRANCH_ID,
            role: "admin",
        },
    });

    await prisma.area.upsert({
        where: { id: AREA_ID },
        update: {
            name: "namdong",
            koreanName: "남동구",
            branchId: BRANCH_ID,
        },
        create: {
            id: AREA_ID,
            name: "namdong",
            koreanName: "남동구",
            branchId: BRANCH_ID,
        },
    });

    for (const template of areaTemplates) {
        await prisma.doc_template.upsert({
            where: { id: template.id },
            update: {
                areaId: template.areaId,
                templateId: template.templateId,
                templateName: template.templateName,
            },
            create: template,
        });
    }

    await prisma.client.upsert({
        where: { id: CLIENT_ID },
        update: {
            name: "홍테스트",
            address: "인천 남동구 테스트로 123",
            phone: "01012345678",
            phoneNormalized: normalizePhone("01012345678"),
            birthday: "900101",
            type: "A가1형",
            duration: 10,
            fullPrice: "1234567",
            grant: "1000000",
            actualPrice: "234567",
            dueDate: new Date("2026-05-30T00:00:00.000Z"),
            careCenter: false,
            voucherClient: true,
            branchId: BRANCH_ID,
            areaId: AREA_ID,
            eDocId: null,
        },
        create: {
            id: CLIENT_ID,
            name: "홍테스트",
            address: "인천 남동구 테스트로 123",
            phone: "01012345678",
            phoneNormalized: normalizePhone("01012345678"),
            birthday: "900101",
            type: "A가1형",
            duration: 10,
            fullPrice: "1234567",
            grant: "1000000",
            actualPrice: "234567",
            dueDate: new Date("2026-05-30T00:00:00.000Z"),
            careCenter: false,
            voucherClient: true,
            branchId: BRANCH_ID,
            areaId: AREA_ID,
            eDocId: null,
        },
    });

    await prisma.employee.upsert({
        where: { id: 1 },
        update: {
            name: "테스트직원",
            workArea: ["남동구"],
            phone: "01000000000",
            phoneNormalized: normalizePhone("01000000000"),
            grade: "A",
            openToNextWork: true,
            companyRegisteredDate: new Date("2026-01-01T00:00:00.000Z"),
            branchId: BRANCH_ID,
        },
        create: {
            id: 1,
            name: "테스트직원",
            workArea: ["남동구"],
            phone: "01000000000",
            phoneNormalized: normalizePhone("01000000000"),
            grade: "A",
            openToNextWork: true,
            companyRegisteredDate: new Date("2026-01-01T00:00:00.000Z"),
            branchId: BRANCH_ID,
        },
    });

    await prisma.employee.upsert({
        where: { id: 2 },
        update: {
            name: "보조직원",
            workArea: ["남동구"],
            phone: "01000000001",
            phoneNormalized: normalizePhone("01000000001"),
            grade: "A",
            openToNextWork: true,
            companyRegisteredDate: new Date("2026-01-02T00:00:00.000Z"),
            branchId: BRANCH_ID,
        },
        create: {
            id: 2,
            name: "보조직원",
            workArea: ["남동구"],
            phone: "01000000001",
            phoneNormalized: normalizePhone("01000000001"),
            grade: "A",
            openToNextWork: true,
            companyRegisteredDate: new Date("2026-01-02T00:00:00.000Z"),
            branchId: BRANCH_ID,
        },
    });

    await prisma.voucher_price_info.upsert({
        where: { id: 2 },
        update: {
            type: "A가1형",
            duration: BigInt(10),
            fullPrice: "1234567",
            grant: "1000000",
            actualPrice: "234567",
            year: 2026,
        },
        create: {
            id: 2,
            type: "A가1형",
            duration: BigInt(10),
            fullPrice: "1234567",
            grant: "1000000",
            actualPrice: "234567",
            year: 2026,
        },
    });

    for (const doc of eformsignDocs) {
        await prisma.eformsign_doc.upsert({
            where: { documentId: doc.documentId },
            update: {
                ...doc,
                branchId: BRANCH_ID,
                expired: false,
            },
            create: {
                ...doc,
                branchId: BRANCH_ID,
                expired: false,
            },
        });
    }

    await prisma.client.update({
        where: { id: CLIENT_ID },
        data: {
            eDocId: "doc-finalize-test",
        },
    });

    for (const template of systemTemplates) {
        const persistedTemplate = await prisma.system_template.upsert({
            where: { templateKey: template.templateKey },
            update: {
                content: template.content,
            },
            create: {
                id: template.id,
                templateKey: template.templateKey,
                content: template.content,
            },
        });

        await upsertSystemTemplateVersion(persistedTemplate.id, template.content);
    }

    // Explicit-id inserts above leave the serial/identity sequences behind the
    // seeded MAX(id); resync so app-level creates (sequence defaults) don't
    // collide with seeded rows.
    await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('client', 'id'), COALESCE((SELECT MAX(id) FROM client), 0) + 1, false)`,
    );
    await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('employee', 'id'), COALESCE((SELECT MAX(id) FROM employee), 0) + 1, false)`,
    );
    await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('employee_schedule', 'id'), COALESCE((SELECT MAX(id) FROM employee_schedule), 0) + 1, false)`,
    );

    console.log(
        `Seeded e2e fixtures for branch ${BRANCH_ID} with ${eformsignDocs.length} documents and ${systemTemplates.length} system templates.`,
    );
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
