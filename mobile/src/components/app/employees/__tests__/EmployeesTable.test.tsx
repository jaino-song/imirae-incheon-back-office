import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmployeesTable } from '../EmployeesTable';
import { useEmployees, useDeleteEmployee, Employee } from '@/hooks/useEmployees';
import { useLocale } from '@/providers/LocaleProvider';

jest.mock('@/hooks/useEmployees');
jest.mock('@/providers/LocaleProvider');
jest.mock('../EmployeeFormDialog', () => ({
  EmployeeFormDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="employee-form-dialog" role="dialog">신규 제공인력 등록</div> : null,
}));
jest.mock('../EmployeeDetailModal', () => ({
  EmployeeDetailModal: ({
    open,
    employee,
  }: {
    open: boolean;
    employee: { name?: string } | null;
  }) =>
    open ? <div data-testid="employee-detail-modal" role="dialog">{employee?.name}</div> : null,
}));

const mockUseEmployees = useEmployees as jest.MockedFunction<typeof useEmployees>;
const mockUseDeleteEmployee = useDeleteEmployee as jest.MockedFunction<typeof useDeleteEmployee>;
const mockUseLocale = useLocale as jest.MockedFunction<typeof useLocale>;

const mockEmployees: Employee[] = [
  {
    id: 1,
    name: '김철수',
    phone: '01012345678',
    status: 'available',
    workArea: ['인천 남동구'],
    grade: '프리미엄',
    openToNextWork: true,
    registeredDate: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 2,
    name: '이영희',
    phone: '01087654321',
    status: 'working',
    workArea: ['인천 연수구'],
    grade: '베스트',
    openToNextWork: false,
    registeredDate: '2026-02-02T00:00:00.000Z',
  },
  {
    id: 3,
    name: '박민수',
    phone: '01055556666',
    status: 'unavailable',
    workArea: ['인천 부평구'],
    grade: '스탠다드',
    openToNextWork: false,
    registeredDate: '2026-02-03T00:00:00.000Z',
  },
];

const mockDeleteMutation = {
  mutateAsync: jest.fn(),
  isPending: false,
  isError: false,
  error: null,
};

beforeAll(() => {
  if (!HTMLElement.prototype.hasPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    });
  }

  if (!HTMLElement.prototype.setPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: () => {},
    });
  }

  if (!HTMLElement.prototype.releasePointerCapture) {
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: () => {},
    });
  }

  if (!Element.prototype.scrollIntoView) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => {},
    });
  }
});

describe('EmployeesTable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocale.mockReturnValue('ko');
    mockUseDeleteEmployee.mockReturnValue(mockDeleteMutation as unknown as ReturnType<typeof useDeleteEmployee>);
  });

  describe('Loading State', () => {
    it('shows loading state when data is being fetched', () => {
      mockUseEmployees.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as unknown as ReturnType<typeof useEmployees>);

      render(<EmployeesTable />);

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.queryByText('등록된 제공인력이 없습니다.')).not.toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('shows error alert when fetch fails', () => {
      const error = new Error('Failed to fetch employees');
      mockUseEmployees.mockReturnValue({
        data: undefined,
        isLoading: false,
        error,
      } as unknown as ReturnType<typeof useEmployees>);

      render(<EmployeesTable />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/직원 목록을 불러오는데 실패했습니다/)).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('shows empty message when no employees exist', () => {
      mockUseEmployees.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      } as unknown as ReturnType<typeof useEmployees>);

      render(<EmployeesTable />);

      expect(screen.getByText('등록된 제공인력이 없습니다.')).toBeInTheDocument();
    });
  });

  describe('Data Rendering', () => {
    beforeEach(() => {
      mockUseEmployees.mockReturnValue({
        data: mockEmployees,
        isLoading: false,
        error: null,
      } as unknown as ReturnType<typeof useEmployees>);
    });

    it('renders employees table with data', () => {
      render(<EmployeesTable />);

      expect(screen.getByText('이름')).toBeInTheDocument();
      expect(screen.getByText('상태')).toBeInTheDocument();
      expect(screen.getByText('연락처')).toBeInTheDocument();

      expect(screen.getByText('김철수')).toBeInTheDocument();
      expect(screen.getByText('이영희')).toBeInTheDocument();
      expect(screen.getByText('박민수')).toBeInTheDocument();
    });

    it('displays phone numbers in formatted format', () => {
      render(<EmployeesTable />);

      expect(screen.getByText('010-1234-5678')).toBeInTheDocument();
      expect(screen.getByText('010-8765-4321')).toBeInTheDocument();
    });

    it('displays correct status badges', () => {
      render(<EmployeesTable />);

      expect(screen.getByText('배정 가능')).toBeInTheDocument();
      expect(screen.getByText('근무 중')).toBeInTheDocument();
      expect(screen.getByText('배정 불가')).toBeInTheDocument();
    });

    it('renders title and subtitle', () => {
      render(<EmployeesTable />);

      expect(screen.getByText('제공인력 관리')).toBeInTheDocument();
      expect(screen.getByText(/제공인력 정보를 관리/)).toBeInTheDocument();
    });
  });

  describe('Filtering', () => {
    beforeEach(() => {
      mockUseEmployees.mockReturnValue({
        data: mockEmployees,
        isLoading: false,
        error: null,
      } as unknown as ReturnType<typeof useEmployees>);
    });

    it('renders filter options', async () => {
      const user = userEvent.setup();
      render(<EmployeesTable />);

      expect(screen.getByRole('combobox')).toBeInTheDocument();
      expect(screen.getByText('전체')).toBeInTheDocument();

      await user.click(screen.getByRole('combobox'));
      expect(await screen.findByRole('option', { name: '배정 가능' })).toBeInTheDocument();
    });

    it('filters employees by status when filter is selected', async () => {
      const user = userEvent.setup();
      render(<EmployeesTable />);

      await user.click(screen.getByRole('combobox'));
      await user.click(await screen.findByRole('option', { name: '배정 가능' }));

      expect(screen.getByText('김철수')).toBeInTheDocument();
      expect(screen.queryByText('이영희')).not.toBeInTheDocument();
      expect(screen.queryByText('박민수')).not.toBeInTheDocument();
    });

    it('filters a working employee by derived status even when next-work availability is false', async () => {
      const user = userEvent.setup();
      render(<EmployeesTable />);

      await user.click(screen.getByRole('combobox'));
      await user.click(await screen.findByRole('option', { name: '근무 중' }));

      expect(screen.getByText('이영희')).toBeInTheDocument();
      expect(screen.queryByText('김철수')).not.toBeInTheDocument();
      expect(screen.queryByText('박민수')).not.toBeInTheDocument();
    });
  });

  describe('Search', () => {
    beforeEach(() => {
      mockUseEmployees.mockReturnValue({
        data: mockEmployees,
        isLoading: false,
        error: null,
      } as unknown as ReturnType<typeof useEmployees>);
    });

    it('renders search input', async () => {
      const user = userEvent.setup();
      render(<EmployeesTable />);

      await user.click(screen.getByRole('button', { name: 'search' }));
      expect(screen.getByPlaceholderText('검색')).toBeInTheDocument();
    });

    it('filters employees when searching by name', async () => {
      const user = userEvent.setup();
      render(<EmployeesTable />);

      await user.click(screen.getByRole('button', { name: 'search' }));
      const searchInput = screen.getByPlaceholderText('검색');
      await user.type(searchInput, '김철수');

      expect(screen.getByText('김철수')).toBeInTheDocument();
      expect(screen.queryByText('이영희')).not.toBeInTheDocument();
    });

    it('filters employees when searching by phone', async () => {
      const user = userEvent.setup();
      render(<EmployeesTable />);

      await user.click(screen.getByRole('button', { name: 'search' }));
      const searchInput = screen.getByPlaceholderText('검색');
      await user.type(searchInput, '8765');

      expect(screen.getByText('이영희')).toBeInTheDocument();
      expect(screen.queryByText('김철수')).not.toBeInTheDocument();
    });
  });

  describe('Row Click', () => {
    beforeEach(() => {
      mockUseEmployees.mockReturnValue({
        data: mockEmployees,
        isLoading: false,
        error: null,
      } as unknown as ReturnType<typeof useEmployees>);
    });

    it('opens detail modal when row is clicked', async () => {
      const user = userEvent.setup();
      render(<EmployeesTable />);

      const employeeRow = screen.getByText('김철수').closest('tr');
      expect(employeeRow).not.toBeNull();
      if (!employeeRow) return;

      await user.click(employeeRow);

      await waitFor(() => {
        expect(screen.getByTestId('employee-detail-modal')).toBeInTheDocument();
      });
      expect(screen.getByTestId('employee-detail-modal')).toHaveTextContent('김철수');
    });
  });

  describe('Add Employee Button', () => {
    beforeEach(() => {
      mockUseEmployees.mockReturnValue({
        data: mockEmployees,
        isLoading: false,
        error: null,
      } as unknown as ReturnType<typeof useEmployees>);
    });

    it('renders add employee button', () => {
      render(<EmployeesTable />);

      expect(screen.getByRole('button', { name: '추가' })).toBeInTheDocument();
    });

    it('opens form dialog when add button is clicked', async () => {
      const user = userEvent.setup();
      render(<EmployeesTable />);

      await user.click(screen.getByRole('button', { name: '추가' }));

      await waitFor(() => {
        expect(screen.getByTestId('employee-form-dialog')).toBeInTheDocument();
      });
    });
  });

  describe('ContentPaper wrapper', () => {
    beforeEach(() => {
      mockUseEmployees.mockReturnValue({
        data: mockEmployees,
        isLoading: false,
        error: null,
      } as unknown as ReturnType<typeof useEmployees>);
    });

    it('wraps content in ContentPaper', () => {
      render(<EmployeesTable />);

      expect(screen.getByTestId('ContentPaper')).toBeInTheDocument();
    });
  });

  describe('English Locale', () => {
    beforeEach(() => {
      mockUseLocale.mockReturnValue('en');
      mockUseEmployees.mockReturnValue({
        data: mockEmployees,
        isLoading: false,
        error: null,
      } as unknown as ReturnType<typeof useEmployees>);
    });

    it('renders English text when locale is en', () => {
      render(<EmployeesTable />);

      expect(screen.getByText('Provider Management')).toBeInTheDocument();
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    it('displays English status badges', () => {
      render(<EmployeesTable />);

      expect(screen.getByText('배정 가능')).toBeInTheDocument();
      expect(screen.getByText('근무 중')).toBeInTheDocument();
      expect(screen.getByText('배정 불가')).toBeInTheDocument();
    });
  });
});
