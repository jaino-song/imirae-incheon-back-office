import { fireEvent, render, screen } from "@testing-library/react";

import {
  MobileDetailActions,
  MobileDetailSheet,
  MobileDetailStack,
} from "../detail-sheet";

const DETAIL_PAGE_SELECTOR = '[data-slot="mobile-detail-stack-detail-page"]';
const SHEET_HANDLE_SELECTOR = '[data-slot="sheet-handle"]';
const SHEET_HEADER_SELECTOR = '[data-slot="sheet-header"]';

const originalPointerEvent = Object.getOwnPropertyDescriptor(
  globalThis,
  "PointerEvent",
);
const originalSetPointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "setPointerCapture",
);
const originalReleasePointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "releasePointerCapture",
);
const mockSetPointerCapture = jest.fn();

beforeAll(() => {
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    value: class PointerEventMock extends MouseEvent {
      readonly isPrimary: boolean;
      readonly pointerId: number;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.isPrimary = init.isPrimary ?? false;
        this.pointerId = init.pointerId ?? 0;
      }
    },
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    writable: true,
    value: mockSetPointerCapture,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
});

afterAll(() => {
  if (originalPointerEvent) {
    Object.defineProperty(globalThis, "PointerEvent", originalPointerEvent);
  } else {
    Reflect.deleteProperty(globalThis, "PointerEvent");
  }

  if (originalSetPointerCapture) {
    Object.defineProperty(
      HTMLElement.prototype,
      "setPointerCapture",
      originalSetPointerCapture,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  }

  if (originalReleasePointerCapture) {
    Object.defineProperty(
      HTMLElement.prototype,
      "releasePointerCapture",
      originalReleasePointerCapture,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "releasePointerCapture");
  }
});

function renderOpenDetailSheet() {
  const onClose = jest.fn();
  const view = render(
    <MobileDetailSheet
      data-component="mobile_tests_detail-sheet"
      name="clients"
      sheetTitle="고명순"
      isOpen
      onClose={onClose}
      list={<div>목록</div>}
      detail={<div>상세</div>}
    />,
  );
  const detailPage = view.container.querySelector<HTMLElement>(
    DETAIL_PAGE_SELECTOR,
  );
  const handle = view.container.querySelector<HTMLElement>(
    SHEET_HANDLE_SELECTOR,
  );
  const header = view.container.querySelector<HTMLElement>(
    SHEET_HEADER_SELECTOR,
  );

  expect(detailPage).not.toBeNull();
  expect(handle).not.toBeNull();
  expect(header).not.toBeNull();
  jest.spyOn(detailPage as HTMLElement, "getBoundingClientRect").mockReturnValue({
    bottom: 600,
    height: 600,
    left: 0,
    right: 400,
    top: 0,
    width: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  return {
    ...view,
    detailPage: detailPage as HTMLElement,
    handle: handle as HTMLElement,
    header: header as HTMLElement,
    onClose,
  };
}

describe("MobileDetailSheet", () => {
  it("keeps the selected item title in the sheet header", () => {
    render(
      <MobileDetailSheet
        data-component="mobile_tests_detail-sheet"
        name="clients"
        sheetTitle="고명순"
        isOpen
        onClose={jest.fn()}
        list={<div>목록</div>}
        detail={<div>상세</div>}
      />,
    );

    expect(screen.getByText("고명순")).toHaveClass("sheet-title");
    expect(
      screen.getAllByRole("button", { name: "상세 닫기" })
        .find((button) => button.classList.contains("sheet-close")),
    ).toBeInTheDocument();
  });

  it("closes after dragging the handle beyond the distance threshold", () => {
    const { detailPage, handle, onClose } = renderOpenDetailSheet();
    mockSetPointerCapture.mockClear();

    fireEvent.pointerDown(handle, {
      clientX: 20,
      clientY: 0,
      isPrimary: true,
      pointerId: 1,
    });

    expect(mockSetPointerCapture).toHaveBeenCalledWith(1);

    fireEvent.pointerMove(handle, {
      clientX: 20,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(handle, {
      clientX: 20,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(detailPage.style.transform).toBe("");
  });

  it("does not close from a drag when closing is disabled", () => {
    const onClose = jest.fn();
    const { container } = render(
      <MobileDetailStack
        data-component="mobile_tests_detail-stack"
        name="clients"
        isOpen
        onClose={onClose}
        closeDisabled
        list={<div>목록</div>}
      >
        <div>상세</div>
      </MobileDetailStack>,
    );
    const detailPage = container.querySelector<HTMLElement>(
      DETAIL_PAGE_SELECTOR,
    );
    const handle = container.querySelector<HTMLElement>(SHEET_HANDLE_SELECTOR);

    expect(detailPage).not.toBeNull();
    expect(handle).not.toBeNull();
    jest.spyOn(detailPage as HTMLElement, "getBoundingClientRect").mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(handle as HTMLElement, {
      clientX: 20,
      clientY: 0,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle as HTMLElement, {
      clientX: 20,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(handle as HTMLElement, {
      clientX: 20,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
    });

    expect(detailPage).not.toHaveClass("sheet-dragging");
    expect(detailPage?.style.transform).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("snaps back after a sub-threshold handle drag", () => {
    const { detailPage, handle, onClose } = renderOpenDetailSheet();

    fireEvent.pointerDown(handle, {
      clientX: 20,
      clientY: 0,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, {
      clientX: 20,
      clientY: 80,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, {
      clientX: 20,
      clientY: 80,
      isPrimary: true,
      pointerId: 1,
    });

    expect(detailPage).toHaveClass("sheet-dragging");
    expect(detailPage).toHaveStyle({ transform: "translateY(80px)" });

    fireEvent.pointerUp(handle, {
      clientX: 20,
      clientY: 80,
      isPrimary: true,
      pointerId: 1,
    });

    expect(detailPage).not.toHaveClass("sheet-dragging");
    expect(detailPage.style.transform).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not claim an upward handle drag", () => {
    const { detailPage, handle, onClose } = renderOpenDetailSheet();

    fireEvent.pointerDown(handle, {
      clientX: 20,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, {
      clientX: 20,
      clientY: 100,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(handle, {
      clientX: 20,
      clientY: 100,
      isPrimary: true,
      pointerId: 1,
    });

    expect(detailPage).not.toHaveClass("sheet-dragging");
    expect(detailPage.style.transform).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("snaps back when a claimed handle drag is cancelled", () => {
    const { detailPage, handle, onClose } = renderOpenDetailSheet();

    fireEvent.pointerDown(handle, {
      clientX: 20,
      clientY: 0,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, {
      clientX: 20,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerCancel(handle, {
      clientX: 20,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
    });

    expect(detailPage).not.toHaveClass("sheet-dragging");
    expect(detailPage.style.transform).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("allows a vertical drag from a non-interactive header area", () => {
    const { detailPage, header, onClose } = renderOpenDetailSheet();

    fireEvent.pointerDown(header, {
      clientX: 20,
      clientY: 0,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(header, {
      clientX: 20,
      clientY: 80,
      isPrimary: true,
      pointerId: 1,
    });

    expect(detailPage).toHaveClass("sheet-dragging");
    expect(detailPage).toHaveStyle({ transform: "translateY(80px)" });

    fireEvent.pointerCancel(header, {
      clientX: 20,
      clientY: 80,
      isPrimary: true,
      pointerId: 1,
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps consumer-provided header buttons interactive", () => {
    const onClose = jest.fn();
    const onHeaderAction = jest.fn();
    const { container } = render(
      <MobileDetailSheet
        data-component="mobile_tests_detail-sheet"
        name="clients"
        sheetTitle={
          <button type="button" onClick={onHeaderAction}>
            Header action
          </button>
        }
        isOpen
        onClose={onClose}
        list={<div>목록</div>}
        detail={<div>상세</div>}
      />,
    );
    const detailPage = container.querySelector<HTMLElement>(
      DETAIL_PAGE_SELECTOR,
    );
    const headerAction = screen.getByRole("button", { name: "Header action" });

    fireEvent.pointerDown(headerAction, {
      clientX: 20,
      clientY: 0,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(headerAction, {
      clientX: 20,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(headerAction, {
      clientX: 20,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.click(headerAction);

    expect(detailPage).not.toHaveClass("sheet-dragging");
    expect(detailPage?.style.transform).toBe("");
    expect(onHeaderAction).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the sheet open for a zero-move header tap outside the close target", () => {
    const { header, onClose } = renderOpenDetailSheet();
    const closeButton = screen
      .getAllByRole("button", { name: "상세 닫기" })
      .find((button) => button.classList.contains("sheet-close"));

    expect(closeButton).toBeDefined();
    jest.spyOn(header, "getBoundingClientRect").mockReturnValue({
      bottom: 64,
      height: 64,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    jest
      .spyOn(closeButton as HTMLButtonElement, "getBoundingClientRect")
      .mockReturnValue({
        bottom: 54,
        height: 44,
        left: 346,
        right: 390,
        top: 10,
        width: 44,
        x: 346,
        y: 10,
        toJSON: () => ({}),
      });

    fireEvent.pointerDown(header, {
      clientX: 200,
      clientY: 32,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(header, {
      clientX: 200,
      clientY: 32,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(header, {
      clientX: 200,
      clientY: 32,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.click(header, { clientX: 200, clientY: 32 });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the X button is clicked", () => {
    const { onClose } = renderOpenDetailSheet();
    const closeButton = screen
      .getAllByRole("button", { name: "상세 닫기" })
      .find((button) => button.classList.contains("sheet-close"));

    expect(closeButton).toBeDefined();
    fireEvent.click(closeButton as HTMLButtonElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("MobileDetailActions", () => {
  it("disables button actions without a click handler or href", () => {
    const { container } = render(
      <MobileDetailActions data-component="mobile_mobile-redesign_tests_detail-sheet_stack_detail-page_actions"
        name="messages"
        actions={[{ label: "재발송", variant: "secondary" }]}
      />,
    );

    expect(screen.getByRole("button", { name: "재발송" })).toBeDisabled();
    expect(
      container.querySelector(
        '[data-component="mobile_mobile-redesign_tests_detail-sheet_stack_detail-page_actions"][data-source-component="MobileDetailActions"]',
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-component="mobile_mobile-redesign_tests_detail-sheet_stack_detail-page_actions_action-1"]',
      ),
    ).toBeDisabled();
  });
});
