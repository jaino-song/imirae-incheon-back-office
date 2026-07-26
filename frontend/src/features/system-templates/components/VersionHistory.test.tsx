import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';

import {
  useResetTemplate,
  useRollbackTemplate,
  useTemplateVersions,
} from '../hooks';
import { VersionHistory } from './VersionHistory';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}));

jest.mock('../hooks', () => ({
  systemTemplateKeys: {
    versionDetail: jest.fn(() => ['system-templates', 'version-detail']),
  },
  useTemplateVersions: jest.fn(),
  useRollbackTemplate: jest.fn(),
  useResetTemplate: jest.fn(),
}));

describe('VersionHistory', () => {
  const rollbackMutateAsync = jest.fn();
  const resetMutateAsync = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useQuery).mockReturnValue({ data: undefined, isLoading: false } as never);
    jest.mocked(useTemplateVersions).mockReturnValue({
      data: [
        {
          versionNumber: 3,
          createdAt: '2026-07-11T00:00:00.000Z',
          createdBy: '관리자',
        },
      ],
      isLoading: false,
    } as never);
    jest.mocked(useRollbackTemplate).mockReturnValue({
      mutateAsync: rollbackMutateAsync,
      isPending: false,
    } as never);
    jest.mocked(useResetTemplate).mockReturnValue({
      mutateAsync: resetMutateAsync,
      isPending: false,
    } as never);
    rollbackMutateAsync.mockResolvedValue(undefined);
    resetMutateAsync.mockResolvedValue(undefined);
  });

  it('uses the shared approval modal before rolling back a version', async () => {
    render(<VersionHistory templateKey="greeting" />);

    fireEvent.click(screen.getByRole('button', { name: '버전 기록' }));
    fireEvent.click(screen.getByRole('button', { name: '이 버전으로 복원' }));

    const dialog = screen.getByRole('dialog', { name: '버전 복원' });
    expect(dialog).toHaveAttribute('data-component', 'desktop_system-templates_version-approval');
    expect(
      screen.getByText('버전 3으로 복원하시겠습니까? 현재 내용은 새 버전으로 저장됩니다.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '복원' }));

    await waitFor(() => {
      expect(rollbackMutateAsync).toHaveBeenCalledWith({
        key: 'greeting',
        versionNumber: 3,
      });
    });
  });

  it('uses the destructive approval action before resetting to defaults', async () => {
    render(<VersionHistory templateKey="greeting" />);

    fireEvent.click(screen.getByRole('button', { name: '버전 기록' }));
    fireEvent.click(screen.getByRole('button', { name: '기본값으로 초기화' }));

    const dialog = screen.getByRole('dialog', { name: '기본값 초기화' });
    expect(dialog).toHaveAttribute('data-component', 'desktop_system-templates_version-approval');
    expect(screen.getByRole('button', { name: '초기화' })).toHaveAttribute(
      'data-variant',
      'destructive',
    );

    fireEvent.click(screen.getByRole('button', { name: '초기화' }));

    await waitFor(() => {
      expect(resetMutateAsync).toHaveBeenCalledWith('greeting');
    });
  });
});
