import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DocumentDropzone } from "../document-dropzone";
import {
  DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES,
  type DocumentUploadCapabilities,
} from "@babyjamjam/shared/file-storage";

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
}));

jest.mock("@/hooks/use-document-categories", () => ({
  useDocumentCategories: () => ({
    data: [{ id: "contracts", label: "계약서" }],
  }),
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/components/ui/select", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const SelectContext = React.createContext<(value: string) => void>(() => {});

  return {
    Select: ({ onValueChange, children }: { onValueChange: (value: string) => void; children: ReactNode }) => (
      <SelectContext.Provider value={onValueChange}>{children}</SelectContext.Provider>
    ),
    SelectTrigger: ({ children, ...props }: ComponentProps<"button">) => (
      <button type="button" {...props}>{children}</button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children, "data-component": dataComponent }: { value: string; children: ReactNode; "data-component"?: string }) => {
      const onValueChange = React.useContext(SelectContext);
      return (
        <button type="button" data-component={dataComponent} onClick={() => onValueChange(value)}>{children}</button>
      );
    },
  };
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  global.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
});

const ownerCapabilities: DocumentUploadCapabilities = {
  ...DEFAULT_DOCUMENT_UPLOAD_CAPABILITIES,
  uploadVisibilityScope: "all_branches",
};

async function selectPdf() {
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "contract.pdf", {
    type: "application/pdf",
  });
  const input = screen.getByLabelText(/파일을 끌어다 놓거나 클릭해 선택하세요|파일 선택/) as HTMLInputElement;

  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText("contract.pdf");
}

describe("DocumentDropzone", () => {
  it("keeps owner uploads private to the current branch when the switch is off", async () => {
    const onUpload = jest.fn().mockResolvedValue(undefined);
    render(
      <DocumentDropzone
        data-component="desktop_files_upload-dialog_dropzone"
        onUpload={onUpload}
        capabilities={ownerCapabilities}
      />,
    );

    await selectPdf();
    fireEvent.change(screen.getByLabelText(/문서 제목/), {
      target: { value: "지점 전용 계약서" },
    });
    fireEvent.click(screen.getByRole("button", { name: "카테고리 *" }));
    fireEvent.click(await screen.findByText("계약서"));
    fireEvent.click(screen.getByRole("switch", { name: "모든 지점에 공개" }));

    expect(screen.getByRole("switch", { name: "모든 지점에 공개" })).not.toBeChecked();

    fireEvent.submit(screen.getByRole("button", { name: "문서 업로드" }).closest("form")!);
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      name: "지점 전용 계약서",
      visibilityScope: "branch",
    }));
    expect(screen.queryByText("오너가 올리는 파일은 모든 지점에서 볼 수 있습니다.")).not.toBeInTheDocument();
  });
});
