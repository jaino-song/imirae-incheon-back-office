export { TenantContext, type VerifiedTenantPrincipal } from './tenant.context';
export { TenantGuard } from './tenant.guard';
export { CurrentTenant } from './current-tenant.decorator';
export { TenantModule } from './tenant.module';
export {
    TenantContextStore,
    tenantContextStore,
    type TenantStoreState,
} from './tenant-context.store';
export { TenantAlsMiddleware } from './tenant-als.middleware';
// `runSystemScope` is deliberately NOT re-exported here: it must be imported
// directly from './run-system-scope' so the eslint no-restricted-imports
// rule on that module path (eslint.config.mjs) can gate it. Re-exporting it
// through this barrel would create an unrestricted side channel.
