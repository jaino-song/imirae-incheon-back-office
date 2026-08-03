import { Injectable, OnModuleInit } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";

import { AgentCapabilityMetaSchema } from "@babyjamjam/shared";

import { AgentCapabilityProvider } from "./capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "./capability.types";
import { CAPABILITY_CATALOG, CAPABILITY_CATALOG_BY_NAME } from "./capability-catalog";

@Injectable()
export class CapabilityRegistryService implements OnModuleInit {
    private readonly capabilities = new Map<string, CapabilityDefinition>();

    constructor(private readonly discoveryService: DiscoveryService) {}

    onModuleInit(): void {
        const providers = this.discoveryService
            .getProviders({ metadataKey: AgentCapabilityProvider.KEY })
            .map((wrapper) => wrapper.instance)
            .filter((instance): instance is AgentCapabilityProviderContract => this.isCapabilityProvider(instance));

        this.registerProviders(providers, true);
    }

    registerProviders(providers: AgentCapabilityProviderContract[], enforceCatalog = false): void {
        const next = new Map<string, CapabilityDefinition>();

        for (const provider of providers) {
            for (const definition of provider.getCapabilities()) {
                const declared = AgentCapabilityMetaSchema.parse(definition.meta);
                const catalogMeta = CAPABILITY_CATALOG_BY_NAME.get(declared.name);
                if (enforceCatalog && !catalogMeta) throw new Error(`Capability is missing from the canonical catalog: ${declared.name}`);
                const meta = AgentCapabilityMetaSchema.parse(catalogMeta ?? declared);
                if (meta.sideEffect && typeof definition.reconcile !== "function") {
                    throw new Error(`Side-effect capability has no restart-safe reconciliation: ${meta.name}`);
                }
                if (next.has(meta.name)) {
                    throw new Error(`Duplicate agent capability: ${meta.name}`);
                }
                next.set(meta.name, { ...definition, meta });
            }
        }

        if (enforceCatalog) {
            const missing = CAPABILITY_CATALOG.filter((entry) => !next.has(entry.name)).map((entry) => entry.name);
            if (missing.length > 0) throw new Error(`Canonical capabilities have no provider: ${missing.join(", ")}`);
        }

        this.capabilities.clear();
        for (const [name, definition] of next) {
            this.capabilities.set(name, definition);
        }
    }

    get(name: string): CapabilityDefinition {
        const definition = this.capabilities.get(name);
        if (!definition) {
            throw new Error(`Unknown agent capability: ${name}`);
        }
        return definition;
    }

    list(): CapabilityDefinition[] {
        return [...this.capabilities.values()].sort((left, right) => left.meta.name.localeCompare(right.meta.name));
    }

    private isCapabilityProvider(instance: unknown): instance is AgentCapabilityProviderContract {
        if (typeof instance !== "object" || instance === null) return false;
        return "getCapabilities" in instance && typeof instance.getCapabilities === "function";
    }
}
