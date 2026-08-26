import { render, screen } from "@testing-library/react";

import type { Employee } from "@/hooks/useEmployees";

import { EmployeeDetailModal } from "../EmployeeDetailModal";

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

jest.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

jest.mock("@/components/app/ui/info-row", () => ({
  InfoRow: ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
}));

const employeeWithoutRegisteredDate = {
  id: 7,
  name: "알 수 없는 직원",
  workArea: ["서울"],
  phone: "010-1234-5678",
  grade: "베스트",
  openToNextWork: true,
  registeredDate: null,
  status: "available",
} as unknown as Employee;

describe("EmployeeDetailModal registration date", () => {
  it("renders a localized unknown value instead of a fabricated date", () => {
    render(
      <EmployeeDetailModal
        open
        onClose={jest.fn()}
        employee={employeeWithoutRegisteredDate}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(screen.getByText("알 수 없음")).toBeInTheDocument();
  });
});
