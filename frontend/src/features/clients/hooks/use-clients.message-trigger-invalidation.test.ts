import { useMutation, useQueryClient } from "@tanstack/react-query";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { useCreateClient, useDeleteClient, useUpdateClient } from "./use-clients";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn((options) => options),
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));

describe("client mutation message job invalidation", () => {
  const invalidateQueries = jest.fn();
  const setQueriesData = jest.fn();
  const setQueryData = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useMutation as jest.Mock).mockImplementation((options) => options);
    (useQueryClient as jest.Mock).mockReturnValue({
      invalidateQueries,
      setQueriesData,
      setQueryData,
    });
  });

  it("invalidates upcoming jobs after creating a client", async () => {
    const mutation = useCreateClient() as unknown as { onSuccess: () => Promise<void> };

    await mutation.onSuccess();

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: messageTriggerKeys.upcoming(),
    });
  });

  it("invalidates upcoming jobs after updating a client", async () => {
    const mutation = useUpdateClient() as unknown as {
      onSuccess: (client: { id: number }, variables: { id: number }) => Promise<void>;
    };

    await mutation.onSuccess({ id: 42 }, { id: 42 });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: messageTriggerKeys.upcoming(),
    });
  });

  it("invalidates upcoming jobs after deleting a client", async () => {
    const mutation = useDeleteClient() as unknown as { onSuccess: () => Promise<void> };

    await mutation.onSuccess();

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: messageTriggerKeys.upcoming(),
    });
  });
});
