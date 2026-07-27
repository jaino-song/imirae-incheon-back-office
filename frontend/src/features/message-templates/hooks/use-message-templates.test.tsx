import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { messageTemplatesApi } from "../api/message-templates.api";
import { messageTemplateKeys } from "./keys";
import { useDeleteMessageTemplate } from "./use-message-templates";

jest.mock("../api/message-templates.api", () => ({
    messageTemplatesApi: {
        delete: jest.fn(),
    },
}));

const mockDelete = messageTemplatesApi.delete as jest.Mock;

describe("useDeleteMessageTemplate", () => {
    it("invalidates message template queries after deletion", async () => {
        mockDelete.mockResolvedValue({ data: null });
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        });
        const invalidateQueries = jest.spyOn(queryClient, "invalidateQueries");
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const { result } = renderHook(() => useDeleteMessageTemplate(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync("template-1");
        });

        expect(mockDelete).toHaveBeenCalledWith("template-1");
        expect(invalidateQueries).toHaveBeenCalledWith({
            queryKey: messageTemplateKeys.all,
        });
    });
});
