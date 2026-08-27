import { QueryClient } from "@tanstack/react-query";

import { useClientDialogStore } from "@/stores/client-dialog-store";
import { useClientWizardStore } from "@/stores/client-wizard-store";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import { useEmployeeWizardStore } from "@/stores/employee-wizard-store";
import { useFormStore } from "@/stores/form-store";
import { useTemplateStore } from "@/stores/template-store";

import { resetAuthorityState } from "./authority-state";

function seedIdentityA(queryClient: QueryClient) {
  queryClient.setQueryData(["authUser"], { id: "user-a", role: "owner" });
  queryClient.setQueryData(["clients", "branch-a"], { id: "client-a", name: "A's client" });

  useFormStore.setState({ name: "A's client", phone: "010-1111-1111", clientId: 101 });
  useClientWizardStore.setState({ name: "A's client", phone: "010-1111-1111" });
  useEmployeeWizardStore.setState({ name: "A's employee", phone: "010-2222-2222" });
  useClientDialogStore.setState({ prefillName: "A's client" });
  useEmployeeDialogStore.setState({ prefillName: "A's employee" });
  useTemplateStore.setState({
    variableValues: { clientName: "A's client", phone: "010-1111-1111" },
    templates: [{ id: "template-a" } as never],
  });
  window.localStorage.setItem("ai_chat_session_id", "chat-session-a");
  window.sessionStorage.setItem("agent_session_id", "session-a");
}

describe("resetAuthorityState", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    useFormStore.getState().resetAll();
    useClientWizardStore.getState().reset();
    useEmployeeWizardStore.getState().reset();
    useClientDialogStore.getState().reset();
    useEmployeeDialogStore.getState().reset();
    useTemplateStore.getState().reset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("removes identity A cache and every PII-bearing draft before identity B can render", async () => {
    seedIdentityA(queryClient);

    await resetAuthorityState(queryClient);

    expect(queryClient.getQueryData(["authUser"])).toBeUndefined();
    expect(queryClient.getQueryData(["clients", "branch-a"])).toBeUndefined();
    expect(useFormStore.getState()).toMatchObject({ name: "", phone: "", clientId: null });
    expect(useClientWizardStore.getState()).toMatchObject({ name: "", phone: "" });
    expect(useEmployeeWizardStore.getState()).toMatchObject({ name: "", phone: "" });
    expect(useClientDialogStore.getState()).toMatchObject({ prefillName: "" });
    expect(useEmployeeDialogStore.getState()).toMatchObject({ prefillName: "" });
    expect(useTemplateStore.getState()).toMatchObject({
      currentTemplate: null,
      variableValues: {},
      templates: [],
      isLoading: false,
    });
    expect(window.localStorage.getItem("ai_chat_session_id")).toBeNull();
    expect(window.sessionStorage.getItem("agent_session_id")).toBeNull();

    queryClient.setQueryData(["authUser"], { id: "user-b", role: "member" });
    expect(queryClient.getQueryData(["authUser"])).toEqual({ id: "user-b", role: "member" });
    expect(useFormStore.getState().name).toBe("");
  });

  it("clears the cache synchronously and prevents an in-flight A response from repopulating it", async () => {
    let resolveRequest: ((value: { owner: string }) => void) | undefined;
    const request = new Promise<{ owner: string }>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchPromise = queryClient.fetchQuery({
      queryKey: ["clients", "branch-a"],
      queryFn: () => request,
    });

    await Promise.resolve();
    const resetPromise = resetAuthorityState(queryClient);
    expect(queryClient.getQueryData(["clients", "branch-a"])).toBeUndefined();

    resolveRequest?.({ owner: "user-a" });
    await fetchPromise.catch(() => undefined);
    await resetPromise;

    expect(queryClient.getQueryData(["clients", "branch-a"])).toBeUndefined();
  });

  it("is safe to repeat for a branch switch and leaves no prior branch data or drafts", async () => {
    seedIdentityA(queryClient);

    await resetAuthorityState(queryClient);
    queryClient.setQueryData(["clients", "branch-b"], { id: "client-b", name: "B's client" });

    expect(queryClient.getQueryData(["clients", "branch-a"])).toBeUndefined();
    expect(queryClient.getQueryData(["clients", "branch-b"])).toEqual({ id: "client-b", name: "B's client" });
    expect(useClientWizardStore.getState().name).toBe("");
    expect(useEmployeeWizardStore.getState().name).toBe("");
  });

  it("continues clearing authority state when browser storage access throws", async () => {
    seedIdentityA(queryClient);

    const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("local storage unavailable");
      },
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new Error("session storage unavailable");
      },
    });

    try {
      await expect(resetAuthorityState(queryClient)).resolves.toBeUndefined();
    } finally {
      if (localStorageDescriptor) {
        Object.defineProperty(window, "localStorage", localStorageDescriptor);
      }
      if (sessionStorageDescriptor) {
        Object.defineProperty(window, "sessionStorage", sessionStorageDescriptor);
      }
    }

    expect(queryClient.getQueryData(["authUser"])).toBeUndefined();
    expect(useFormStore.getState()).toMatchObject({ name: "", phone: "", clientId: null });
  });

  it("continues clearing authority state when browser storage removal throws", async () => {
    seedIdentityA(queryClient);

    const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    const localRemoveItem = jest.fn(() => {
      throw new Error("local storage removal unavailable");
    });
    const sessionRemoveItem = jest.fn(() => {
      throw new Error("session storage removal unavailable");
    });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { removeItem: localRemoveItem },
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: { removeItem: sessionRemoveItem },
    });

    try {
      await expect(resetAuthorityState(queryClient)).resolves.toBeUndefined();
      expect(localRemoveItem).toHaveBeenCalledWith("ai_chat_session_id");
      expect(sessionRemoveItem).toHaveBeenCalledWith("agent_session_id");
    } finally {
      if (localStorageDescriptor) {
        Object.defineProperty(window, "localStorage", localStorageDescriptor);
      }
      if (sessionStorageDescriptor) {
        Object.defineProperty(window, "sessionStorage", sessionStorageDescriptor);
      }
    }

    expect(queryClient.getQueryData(["authUser"])).toBeUndefined();
    expect(useFormStore.getState()).toMatchObject({ name: "", phone: "", clientId: null });
  });
});
