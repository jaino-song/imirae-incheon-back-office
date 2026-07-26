import { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: keyof T | string;
  header: string;
  align?: "left" | "center" | "right";
  width?: string;
  render?: (row: T, index: number) => ReactNode;
}

export interface FilterOption {
  label: string;
  value: string | null;
  /** Accepts shadcn variants + "error" for backwards compat (mapped to "destructive") */
  color?: "default" | "primary" | "secondary" | "destructive" | "error" | "info" | "success" | "warning";
  /** @deprecated Use className-based styling instead */
  chipSx?: Record<string, unknown>;
}

export type PaginationMode = "client" | "server" | "none";

export interface DataTableProps<T> {
  "data-component"?: string;
  data: T[];
  columns: DataTableColumn<T>[];
  isLoading?: boolean;
  error?: Error | null;
  getRowKey: (row: T, index: number) => string | number;
  // search
  searchEnabled?: boolean;
  searchPlaceholder?: string;
  searchFields?: (keyof T)[];
  onSearch?: (query: string) => void;
  searchQuery?: string;
  // filter
  filterOptions?: FilterOption[];
  onFilterChange?: (value: string | null) => void;
  filterValue?: string | null;
  filterAddAction?: FilterAddAction;
  // pagination
  pagination?: PaginationMode;
  totalCount?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  page?: number;
  // row interaction
  onRowClick?: (row: T, index: number) => void;
  // toolbar
  toolbarActions?: ReactNode;
  hideToolbar?: boolean;
  // empty state
  emptyMessage?: string;
  // styling
  className?: string;
  /** @deprecated Use className instead */
  sx?: Record<string, unknown>;
  skeletonRowCount?: number;
}

export interface FilterAddAction {
  label: string;
  onClick: () => void;
}

export interface DataTableToolbarProps {
  searchEnabled?: boolean;
  searchPlaceholder?: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterOptions?: FilterOption[];
  filterValue: string | null;
  onFilterChange?: (value: string | null) => void;
  filterAddAction?: FilterAddAction;
  actions?: ReactNode;
}

export interface DataTablePaginationProps {
  "data-component"?: string;
  count: number;
  page: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}
