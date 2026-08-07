import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrate() {
  console.log('[Migration] Starting multi-tenancy migration...');
  try {
    const firstUser = await prisma.user.findFirst({
      select: { id: true, kakaoId: true },
      orderBy: { id: 'asc' },
    });
    console.log(`[Migration] First user: ${firstUser?.kakaoId || 'none'}`);

    if (!firstUser) {
      console.error('[Migration] No users found in database. Cannot create branch without owner.');
      process.exit(1);
    }

    let org = await prisma.branch.findUnique({
      where: { slug: 'incheon' }
    });
    
    if (!org) {
      org = await prisma.branch.create({
        data: {
          id: crypto.randomUUID(),
          name: '인천점',
          slug: 'incheon',
          description: '기본 지점',
          email: 'incheon@mirae-incheon.com',
          phone: '',
          address: '',
          isActive: true,
          ownerId: firstUser.id
        },
      });
      console.log(`[Migration] Created branch: ${org.name} (ID: ${org.id})`);
    } else {
      console.log(`[Migration] Found existing branch: ${org.name} (ID: ${org.id})`);
    }

    const existingUserOrg = await prisma.user_branch.findFirst({
      where: {
        userId: firstUser.id,
        branchId: org.id
      }
    });
    
    if (!existingUserOrg) {
      await prisma.user_branch.create({
        data: {
          id: crypto.randomUUID(),
          userId: firstUser.id,
          branchId: org.id,
          role: 'admin',
          joinedAt: new Date(),
        },
      });
      console.log('[Migration] Added first user to branch as admin');
    } else {
      console.log('[Migration] User already associated with branch');
    }

    const clientCount = await prisma.client.count();
    console.log(`[Migration] Found ${clientCount} clients`);
    let clientsUpdated = 0;
    const batchSize = 100;
    let skip = 0;

    while (skip < clientCount) {
      const clients = await prisma.client.findMany({
        select: { id: true },
        skip: skip,
        take: batchSize,
      });
      if (clients.length === 0) break;
      await prisma.client.updateMany({
        where: { id: { in: clients.map((c: {id: number}) => c.id) } },
        data: { branchId: org.id },
      });
      clientsUpdated += clients.length;
      skip += batchSize;
      if (clientsUpdated % 100 === 0) {
        console.log(`[Migration] Updated ${clientsUpdated}/${clientCount} clients...`);
      }
    }
    console.log(`[Migration] Assigned ${clientsUpdated} clients`);

    const employeeCount = await prisma.employee.count();
    console.log(`[Migration] Found ${employeeCount} employees`);
    let employeesUpdated = 0;
    skip = 0;

    while (skip < employeeCount) {
      const employees = await prisma.employee.findMany({
        select: { id: true },
        skip: skip,
        take: batchSize,
      });
      if (employees.length === 0) break;
      await prisma.employee.updateMany({
        where: { id: { in: employees.map((e: {id: number}) => e.id) } },
        data: { branchId: org.id },
      });
      employeesUpdated += employees.length;
      skip += batchSize;
      if (employeesUpdated % 100 === 0) {
        console.log(`[Migration] Updated ${employeesUpdated}/${employeeCount} employees...`);
      }
    }
    console.log(`[Migration] Assigned ${employeesUpdated} employees`);

    const scheduleCount = await prisma.employee_schedule.count();
    console.log(`[Migration] Found ${scheduleCount} employee_schedules`);
    let schedulesUpdated = 0;
    skip = 0;

    while (skip < scheduleCount) {
      const schedules = await prisma.employee_schedule.findMany({
        select: { id: true },
        skip: skip,
        take: batchSize,
      });
      if (schedules.length === 0) break;
      await prisma.employee_schedule.updateMany({
        where: { id: { in: schedules.map((s: {id: number}) => s.id) } },
        data: { branchId: org.id },
      });
      schedulesUpdated += schedules.length;
      skip += batchSize;
      if (schedulesUpdated % 100 === 0) {
        console.log(`[Migration] Updated ${schedulesUpdated}/${scheduleCount} schedules...`);
      }
    }
    console.log(`[Migration] Assigned ${schedulesUpdated} employee_schedules`);

    const eformDocCount = await prisma.eformsign_doc.count();
    console.log(`[Migration] Found ${eformDocCount} eformsign_docs`);
    let eformDocsUpdated = 0;
    skip = 0;

    while (skip < eformDocCount) {
      const docs = await prisma.eformsign_doc.findMany({
        select: { id: true },
        skip: skip,
        take: batchSize,
      });
      if (docs.length === 0) break;
      await prisma.eformsign_doc.updateMany({
        where: { id: { in: docs.map((d: {id: number}) => d.id) } },
        data: { branchId: org.id },
      });
      eformDocsUpdated += docs.length;
      skip += batchSize;
      if (eformDocsUpdated % 100 === 0) {
        console.log(`[Migration] Updated ${eformDocsUpdated}/${eformDocCount} docs...`);
      }
    }
    console.log(`[Migration] Assigned ${eformDocsUpdated} eformsign_docs`);

    const messageCount = await prisma.message.count();
    console.log(`[Migration] Found ${messageCount} messages`);
    let messagesUpdated = 0;
    skip = 0;

    while (skip < messageCount) {
      const messages = await prisma.message.findMany({
        select: { id: true },
        skip: skip,
        take: batchSize,
      });
      if (messages.length === 0) break;
      await prisma.message.updateMany({
        where: { id: { in: messages.map((m: {id: number}) => m.id) } },
        data: { branchId: org.id },
      });
      messagesUpdated += messages.length;
      skip += batchSize;
      if (messagesUpdated % 100 === 0) {
        console.log(`[Migration] Updated ${messagesUpdated}/${messageCount} messages...`);
      }
    }
    console.log(`[Migration] Assigned ${messagesUpdated} messages`);

    const templateCount = await prisma.message_template.count();
    console.log(`[Migration] Found ${templateCount} message_templates`);
    let templatesUpdated = 0;
    skip = 0;

    while (skip < templateCount) {
      const templates = await prisma.message_template.findMany({
        select: { id: true },
        skip: skip,
        take: batchSize,
      });
      if (templates.length === 0) break;
      await prisma.message_template.updateMany({
        where: { id: { in: templates.map((t: {id: string}) => t.id) } },
        data: { branchId: org.id, isCustom: true },
      });
      templatesUpdated += templates.length;
      skip += batchSize;
      if (templatesUpdated % 100 === 0) {
        console.log(`[Migration] Updated ${templatesUpdated}/${templateCount} templates...`);
      }
    }
    console.log(`[Migration] Assigned ${templatesUpdated} message_templates`);

    const notifCount = await prisma.notification.count();
    console.log(`[Migration] Found ${notifCount} notifications`);
    let notifsUpdated = 0;
    skip = 0;

    while (skip < notifCount) {
      const notifs = await prisma.notification.findMany({
        select: { id: true },
        skip: skip,
        take: batchSize,
      });
      if (notifs.length === 0) break;
      await prisma.notification.updateMany({
        where: { id: { in: notifs.map((n: {id: number}) => n.id) } },
        data: { branchId: org.id },
      });
      notifsUpdated += notifs.length;
      skip += batchSize;
      if (notifsUpdated % 100 === 0) {
        console.log(`[Migration] Updated ${notifsUpdated}/${notifCount} notifications...`);
      }
    }
    console.log(`[Migration] Assigned ${notifsUpdated} notifications`);

    const categoryCount = await prisma.document_category.count();
    console.log(`[Migration] Found ${categoryCount} document_categories`);
    let categoriesUpdated = 0;
    skip = 0;

    while (skip < categoryCount) {
      const categories = await prisma.document_category.findMany({
        select: { id: true },
        skip: skip,
        take: batchSize,
      });
      if (categories.length === 0) break;
      await prisma.document_category.updateMany({
        where: { id: { in: categories.map((c: {id: string}) => c.id) } },
        data: { branchId: org.id, isCustom: true },
      });
      categoriesUpdated += categories.length;
      skip += batchSize;
      if (categoriesUpdated % 100 === 0) {
        console.log(`[Migration] Updated ${categoriesUpdated}/${categoryCount} categories...`);
      }
    }
    console.log(`[Migration] Assigned ${categoriesUpdated} document_categories`);

    // Backfill every document, exactly like every other entity in this script.
    // The old code filtered on the legacy orgId column while writing branchId, so
    // any document that already carried a non-null orgId was silently skipped and
    // kept branch_id = NULL — invisible to every branch forever.
    const docCount = await prisma.document.count();
    console.log(`[Migration] Found ${docCount} documents`);
    let docsUpdated = 0;
    skip = 0;

    while (skip < docCount) {
      const docs = await prisma.document.findMany({
        select: { id: true },
        skip: skip,
        take: batchSize,
      });
      if (docs.length === 0) break;
      await prisma.document.updateMany({
        where: { id: { in: docs.map((d: {id: string}) => d.id) } },
        data: { branchId: org.id },
      });
      docsUpdated += docs.length;
      skip += batchSize;
      if (docsUpdated % 100 === 0) {
        console.log(`[Migration] Updated ${docsUpdated}/${docCount} documents...`);
      }
    }
    console.log(`[Migration] Assigned ${docsUpdated} documents`);

    const areaCount = await prisma.area.count();
    console.log(`[Migration] Found ${areaCount} areas`);
    let areasUpdated = 0;
    skip = 0;

    while (skip < areaCount) {
      const areas = await prisma.area.findMany({
        select: { id: true },
        skip: skip,
        take: batchSize,
      });
      if (areas.length === 0) break;
      await prisma.area.updateMany({
        where: { id: { in: areas.map((a: {id: string}) => a.id) } },
        data: { branchId: org.id },
      });
      areasUpdated += areas.length;
      skip += batchSize;
      if (areasUpdated % 100 === 0) {
        console.log(`[Migration] Updated ${areasUpdated}/${areaCount} areas...`);
      }
    }
    console.log(`[Migration] Assigned ${areasUpdated} areas`);

    console.log('[Migration] Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('[Migration] Error:', error);
    process.exit(1);
  }
}

migrate();
