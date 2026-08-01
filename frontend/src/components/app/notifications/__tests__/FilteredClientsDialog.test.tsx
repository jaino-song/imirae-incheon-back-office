import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FilteredClientsDialog } from '../FilteredClientsDialog';
import type { Client } from '@/lib/client/types';

const mockDeleteMutateAsync = jest.fn();

const mockClient: Client = {
    id: 1,
    name: 'Test Client',
    address: 'Test Address',
    phone: '010-1234-5678',
    type: 'A',
    duration: 30,
    fullPrice: '100000',
    grant: '50000',
    actualPrice: '50000',
    startDate: '2026-01-20',
    endDate: '2026-02-20',
    careCenter: false,
    voucherClient: true,
    birthday: '900101',
    serviceStatus: 'waiting',
    breastPump: false,
    eDocId: null,
    documentStatus: null,
    primaryEmployee: null,
    secondaryEmployee: null,
    hasSigned: false,
    dueDate: null,
    birthDate: null,
};

let mockFilteredClients: Client[] = [];
let mockSingleClient: Client | undefined = undefined;
let mockFilteredLoading = false;
let mockSingleLoading = false;

jest.mock('@/hooks/useClients', () => ({
    useFilteredClients: (filter: string) => ({
        data: filter ? mockFilteredClients : [],
        isLoading: mockFilteredLoading,
        error: null,
    }),
    useClient: (id: number) => ({
        data: id ? mockSingleClient : undefined,
        isLoading: mockSingleLoading,
        error: null,
    }),
    useDeleteClient: () => ({
        mutateAsync: mockDeleteMutateAsync,
    }),
}));

jest.mock('../../clients/ClientDetailModal', () => ({
    ClientDetailModal: ({ open, client }: { open: boolean; client: Client | null }) => (
        open ? <div data-testid="client-detail-modal">{client?.name}</div> : null
    ),
}));

jest.mock('../../clients/ClientFormDialog', () => ({
    ClientFormDialog: ({ open }: { open: boolean }) => (
        open ? <div data-testid="client-form-dialog">Form Dialog</div> : null
    ),
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockFilteredClients = [];
    mockSingleClient = undefined;
    mockFilteredLoading = false;
    mockSingleLoading = false;
});

describe('FilteredClientsDialog', () => {
    describe('given dialog is open with filter type', () => {
        it('should display correct title for starting-soon filter', () => {
            mockFilteredClients = [mockClient];

            render(
                <FilteredClientsDialog
                    open={true}
                    onClose={jest.fn()}
                    filterType="starting-soon"
                />
            );

            expect(screen.getByText('7일 내 서비스 시작 예정')).toBeInTheDocument();
        });

        it('should display correct title for incomplete-contracts filter', () => {
            mockFilteredClients = [mockClient];

            render(
                <FilteredClientsDialog
                    open={true}
                    onClose={jest.fn()}
                    filterType="incomplete-contracts"
                />
            );

            expect(screen.getByText('계약서 미완료')).toBeInTheDocument();
        });

        it('should display client data in table', () => {
            mockFilteredClients = [mockClient];

            render(
                <FilteredClientsDialog
                    open={true}
                    onClose={jest.fn()}
                    filterType="starting-soon"
                />
            );

            expect(screen.getByText('Test Client')).toBeInTheDocument();
        });
    });

    describe('given dialog is open with clientId', () => {
        it('should display single client', () => {
            mockSingleClient = mockClient;

            render(
                <FilteredClientsDialog
                    open={true}
                    onClose={jest.fn()}
                    filterType={null}
                    clientId={1}
                />
            );

            expect(screen.getAllByText('Test Client').length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('given no clients match filter', () => {
        it('should display empty message', () => {
            mockFilteredClients = [];

            render(
                <FilteredClientsDialog
                    open={true}
                    onClose={jest.fn()}
                    filterType="starting-soon"
                />
            );

            expect(screen.getByText('해당하는 클라이언트가 없습니다')).toBeInTheDocument();
        });
    });

    describe('given loading state', () => {
        it('should display loading spinner', () => {
            mockFilteredLoading = true;

            render(
                <FilteredClientsDialog
                    open={true}
                    onClose={jest.fn()}
                    filterType="starting-soon"
                />
            );

            expect(document.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
        });
    });

    describe('given user clicks a client row', () => {
        it('should open client detail modal', async () => {
            mockFilteredClients = [mockClient];

            render(
                <FilteredClientsDialog
                    open={true}
                    onClose={jest.fn()}
                    filterType="starting-soon"
                />
            );

            fireEvent.click(screen.getByText('Test Client'));

            await waitFor(() => {
                expect(screen.getByTestId('client-detail-modal')).toBeInTheDocument();
            });
        });
    });

    describe('given user clicks close button', () => {
        it('should call onClose callback', () => {
            const mockOnClose = jest.fn();
            mockFilteredClients = [mockClient];

            render(
                <FilteredClientsDialog
                    open={true}
                    onClose={mockOnClose}
                    filterType="starting-soon"
                />
            );

            const closeButton = screen.getByRole('button', { name: 'Close' });
            fireEvent.click(closeButton);

            expect(mockOnClose).toHaveBeenCalled();
        });
    });
});
