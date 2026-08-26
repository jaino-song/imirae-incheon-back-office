import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
    type Document,
    documentQueryKeys,
    useDeleteDocument,
    useUpdateDocument,
    useUploadDocument,
} from "../use-documents";
import {
    templateQueryKeys,
    useCreateMessageTemplate,
    useDeleteMessageTemplate,
    useUpdateMessageTemplate,
} from "../use-message-templates";
import {
    consultationInquiryQueryKeys,
    useMarkConsultationInquiryAsRead,
} from "../use-consultation-inquiries";
import type { MessageTemplate } from "@/lib/template/types";
import type { ConsultationInquiry } from "@/lib/consultation-inquiry/types";
import { api } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
    api: {
        delete: jest.fn(),
        get: jest.fn(),
        patch: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
    },
}));

const mockedApiDelete = api.delete as jest.MockedFunction<typeof api.delete>;
const mockedApiPatch = api.patch as jest.MockedFunction<typeof api.patch>;
const mockedApiPost = api.post as jest.MockedFunction<typeof api.post>;
const mockedApiPut = api.put as jest.MockedFunction<typeof api.put>;

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
    let resolvePromise: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });

    return { promise, resolve: resolvePromise };
}

function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false },
        },
    });
}

function createWrapper(queryClient: QueryClient) {
    return function QueryClientTestWrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
}

async function expectMutationToWaitForInvalidations<T>(
    queryClient: QueryClient,
    expectedQueryKeys: readonly (readonly unknown[])[],
    startMutation: () => Promise<T>,
) {
    const invalidations = expectedQueryKeys.map(() => deferred<void>());
    let invalidationIndex = 0;
    const invalidateQueries = jest.spyOn(queryClient, "invalidateQueries").mockImplementation(() => {
        const invalidation = invalidations[invalidationIndex];
        invalidationIndex += 1;
        return invalidation?.promise ?? Promise.resolve();
    });

    const mutationPromise = startMutation();
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(expectedQueryKeys.length));
    expect(invalidateQueries.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(expectedQueryKeys);

    let mutationSettled = false;
    void mutationPromise.then(() => {
        mutationSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mutationSettled).toBe(false);

    invalidations[0]?.resolve(undefined);
    if (invalidations.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mutationSettled).toBe(false);
    }
    invalidations.slice(1).forEach((invalidation) => invalidation.resolve(undefined));
    await mutationPromise;
}

const documentResponse: Document = {
    id: "document-1",
    name: "Guide",
    description: null,
    categoryId: "category-1",
    categoryLabel: "Guides",
    tags: [],
    mimeType: "application/pdf",
    fileSize: 42,
    storagePath: "documents/document-1.pdf",
    storageUrl: null,
    orgId: "org-1",
    uploadedBy: "user-1",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    visibilityScope: "branch",
    canManage: true,
};

const templateResponse: MessageTemplate = {
    id: "template-1",
    name: "Welcome",
    content: "Hello",
    variables: [],
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
};

const inquiryResponse: ConsultationInquiry = {
    id: "inquiry-1",
    branchId: "branch-1",
    publicBranchSlug: "branch",
    motherName: "Customer",
    phone: "010-0000-0000",
    address: "Address",
    dueDate: "2026-09-01",
    birthExperience: "none",
    voucherType: null,
    preferredCaregiverName: null,
    referralSource: "web",
    privacyAcceptedAt: "2026-08-27T00:00:00.000Z",
    selectedServices: null,
    additionalNotes: null,
    source: "web",
    status: "contacted",
    readAt: "2026-08-27T00:00:00.000Z",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
};

describe("mobile mutation invalidation lifecycle", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("documents", () => {
        it("waits for list invalidation after uploading a document", async () => {
            mockedApiPost.mockResolvedValue({ data: documentResponse } as never);
            const queryClient = createQueryClient();
            const { result } = renderHook(() => useUploadDocument(), {
                wrapper: createWrapper(queryClient),
            });

            await expectMutationToWaitForInvalidations(
                queryClient,
                [documentQueryKeys.all],
                () => result.current.mutateAsync({
                    categoryId: "category-1",
                    file: new File(["document"], "guide.pdf", { type: "application/pdf" }),
                }),
            );
        });

        it("waits for list and detail invalidations after updating a document", async () => {
            mockedApiPut.mockResolvedValue({ data: documentResponse } as never);
            const queryClient = createQueryClient();
            const { result } = renderHook(() => useUpdateDocument(), {
                wrapper: createWrapper(queryClient),
            });

            await expectMutationToWaitForInvalidations(
                queryClient,
                [documentQueryKeys.all, documentQueryKeys.detail(documentResponse.id)],
                () => result.current.mutateAsync({
                    id: documentResponse.id,
                    name: "Renamed guide",
                }),
            );
        });

        it("waits for list invalidation after deleting a document", async () => {
            mockedApiDelete.mockResolvedValue({ data: undefined } as never);
            const queryClient = createQueryClient();
            const { result } = renderHook(() => useDeleteDocument(), {
                wrapper: createWrapper(queryClient),
            });

            await expectMutationToWaitForInvalidations(
                queryClient,
                [documentQueryKeys.all],
                () => result.current.mutateAsync(documentResponse.id),
            );
        });
    });

    describe("message templates", () => {
        it("waits for list invalidation after creating a message template", async () => {
            mockedApiPost.mockResolvedValue({ data: templateResponse } as never);
            const queryClient = createQueryClient();
            const { result } = renderHook(() => useCreateMessageTemplate(), {
                wrapper: createWrapper(queryClient),
            });

            await expectMutationToWaitForInvalidations(
                queryClient,
                [templateQueryKeys.all],
                () => result.current.mutateAsync({
                    content: templateResponse.content,
                    name: templateResponse.name,
                    variables: [],
                }),
            );
        });

        it("waits for list and detail invalidations after updating a message template", async () => {
            mockedApiPatch.mockResolvedValue({ data: templateResponse } as never);
            const queryClient = createQueryClient();
            const { result } = renderHook(() => useUpdateMessageTemplate(), {
                wrapper: createWrapper(queryClient),
            });

            await expectMutationToWaitForInvalidations(
                queryClient,
                [templateQueryKeys.all, templateQueryKeys.detail(templateResponse.id)],
                () => result.current.mutateAsync({
                    id: templateResponse.id,
                    request: { name: "Updated welcome" },
                }),
            );
        });

        it("waits for list invalidation after deleting a message template", async () => {
            mockedApiDelete.mockResolvedValue({ data: undefined } as never);
            const queryClient = createQueryClient();
            const { result } = renderHook(() => useDeleteMessageTemplate(), {
                wrapper: createWrapper(queryClient),
            });

            await expectMutationToWaitForInvalidations(
                queryClient,
                [templateQueryKeys.all],
                () => result.current.mutateAsync(templateResponse.id),
            );
        });
    });

    it("waits for list invalidation after marking a consultation inquiry as read", async () => {
        mockedApiPatch.mockResolvedValue({ data: inquiryResponse } as never);
        const queryClient = createQueryClient();
        const { result } = renderHook(() => useMarkConsultationInquiryAsRead(), {
            wrapper: createWrapper(queryClient),
        });

        await expectMutationToWaitForInvalidations(
            queryClient,
            [consultationInquiryQueryKeys.all],
            () => result.current.mutateAsync(inquiryResponse.id),
        );
    });
});
