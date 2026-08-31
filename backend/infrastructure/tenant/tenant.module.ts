import { Global, Module } from '@nestjs/common';
import { TenantContext } from './tenant.context';
import { TenantGuard } from './tenant.guard';
import { TenantAlsMiddleware } from './tenant-als.middleware';
import { DatabaseModule } from '../database/database.module';

@Global()
@Module({
    imports: [DatabaseModule],
    providers: [TenantContext, TenantGuard, TenantAlsMiddleware],
    exports: [TenantContext, TenantGuard, TenantAlsMiddleware],
})
export class TenantModule {}
