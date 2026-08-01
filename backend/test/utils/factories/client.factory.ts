import { ClientEntity } from "domain/entities/client.entity";

/**
 * ClientEntity를 생성하기 위한 테스트 팩토리
 * 기본값을 제공하여 테스트 코드를 간결하게 유지
 */
export interface CreateClientFactoryParams {
    id?: number;
    name?: string;
    address?: string | null;
    phone?: string | null;
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    careCenter?: boolean;
    voucherClient?: boolean;
    birthday?: string | null;
    dueDate?: Date | null;
    serviceStatus?: string | null;
    breastPump?: boolean;
    eDocId?: string | null;
    birthDate?: Date | null;
}

export class ClientFactory {
    /**
     * 기본값이 적용된 ClientEntity 생성
     */
    static create(params: CreateClientFactoryParams = {}): ClientEntity {
        return ClientEntity.reconstitute(
            params.id ?? 1,
            params.name ?? "Test Client",
            params.address ?? "서울시 강남구 테헤란로 123",
            params.phone ?? "010-1234-5678",
            params.type ?? "A형",
            params.duration ?? 15,
            params.fullPrice ?? "1000000",
            params.grant ?? "500000",
            params.actualPrice ?? "500000",
            params.startDate ?? new Date("2024-01-01"),
            params.endDate ?? new Date("2024-12-31"),
            params.careCenter ?? false,
            params.voucherClient ?? true,
            params.birthday ?? "1990-01-01",
            params.dueDate ?? null,
            params.serviceStatus ?? "active",
            params.breastPump ?? false,
            params.eDocId ?? null,
            null,
            null,
            null,
            false,
            params.birthDate ?? null,
        );
    }

    /**
     * 여러 ClientEntity 생성
     */
    static createMany(count: number, baseParams: CreateClientFactoryParams = {}): ClientEntity[] {
        return Array.from({ length: count }, (_, index) =>
            ClientFactory.create({
                ...baseParams,
                id: baseParams.id ?? index + 1,
                name: baseParams.name ?? `Test Client ${index + 1}`,
            })
        );
    }

    /**
     * 바우처 클라이언트 생성
     */
    static createVoucherClient(params: CreateClientFactoryParams = {}): ClientEntity {
        return ClientFactory.create({
            ...params,
            voucherClient: true,
            type: params.type ?? "바우처",
        });
    }

    /**
     * 산후조리원 클라이언트 생성
     */
    static createCareCenterClient(params: CreateClientFactoryParams = {}): ClientEntity {
        return ClientFactory.create({
            ...params,
            careCenter: true,
        });
    }

    /**
     * 계약 완료 클라이언트 생성
     */
    static createSignedClient(params: CreateClientFactoryParams = {}): ClientEntity {
        return ClientFactory.create({
            ...params,
            eDocId: params.eDocId ?? "doc_signed_12345",
            serviceStatus: "signed",
        });
    }
}
