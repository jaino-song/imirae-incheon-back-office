"use client";

import * as React from "react";

const TOAST_LIMIT = 1;
const DEFAULT_TOAST_DURATION = 4000;
const TOAST_REMOVE_DELAY = 300;

type ToasterToast = {
  id: string;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  variant?: "default" | "success" | "destructive";
  duration?: number;
};

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

type Action =
  | {
      type: "ADD_TOAST";
      toast: ToasterToast;
    }
  | {
      type: "UPDATE_TOAST";
      toast: Partial<ToasterToast>;
    }
  | {
      type: "DISMISS_TOAST";
      toastId?: ToasterToast["id"];
    }
  | {
      type: "REMOVE_TOAST";
      toastId?: ToasterToast["id"];
    };

interface State {
  toasts: ToasterToast[];
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const toastAutoDismissTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const clearToastTimers = (toastId: string) => {
  const removeTimeout = toastTimeouts.get(toastId);
  if (removeTimeout) {
    clearTimeout(removeTimeout);
    toastTimeouts.delete(toastId);
  }

  const autoDismissTimeout = toastAutoDismissTimeouts.get(toastId);
  if (autoDismissTimeout) {
    clearTimeout(autoDismissTimeout);
    toastAutoDismissTimeouts.delete(toastId);
  }
};

const addToAutoDismissQueue = (toastId: string, duration = DEFAULT_TOAST_DURATION) => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return;
  }

  const existingTimeout = toastAutoDismissTimeouts.get(toastId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  const timeout = setTimeout(() => {
    toastAutoDismissTimeouts.delete(toastId);
    dispatch({
      type: "DISMISS_TOAST",
      toastId,
    });
  }, duration);

  toastAutoDismissTimeouts.set(toastId, timeout);
};

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };

    case "DISMISS_TOAST": {
      const { toastId } = action;

      if (toastId) {
        const autoDismissTimeout = toastAutoDismissTimeouts.get(toastId);
        if (autoDismissTimeout) {
          clearTimeout(autoDismissTimeout);
          toastAutoDismissTimeouts.delete(toastId);
        }
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast) => {
          const autoDismissTimeout = toastAutoDismissTimeouts.get(toast.id);
          if (autoDismissTimeout) {
            clearTimeout(autoDismissTimeout);
            toastAutoDismissTimeouts.delete(toast.id);
          }
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
              }
            : t
        ),
      };
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        for (const toast of state.toasts) {
          clearToastTimers(toast.id);
        }
        return {
          ...state,
          toasts: [],
        };
      }
      clearToastTimers(action.toastId);
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners: Array<(state: State) => void> = [];

let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

type Toast = Omit<ToasterToast, "id">;

function toast({ ...props }: Toast) {
  const id = genId();

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    });
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id });

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
    },
  });
  addToAutoDismissQueue(id, props.duration);

  return {
    id: id,
    dismiss,
    update,
  };
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  };
}

export { useToast, toast };
