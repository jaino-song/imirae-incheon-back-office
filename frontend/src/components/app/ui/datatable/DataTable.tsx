"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { DataTableToolbar } from "./DataTableToolbar";
import { DataTablePagination } from "./DataTablePagination";
import { matchesSearchQuery, type SearchableValue } from "@/lib/search/korean-search";
import type { DataTableProps } from "./types";

const SOURCE_COMPONENT = "DataTable";

interface DataTableRootProps extends React.HTMLAttributes<HTMLDivElement> {
  dataComponent?: string;
}

function DataTableRoot({
  dataComponent,
  className,
  ...props
}: DataTableRootProps) {
  if (dataComponent) {
    return (
      <div
        data-component={dataComponent}
        data-source-component={SOURCE_COMPONENT}
        className={className}
        {...props}
      />
    );
  }

  return (
    <div
      // TODO(data-component): Remove the legacy fallback after all callers migrate.
      data-component="desktop_v3_data-table"
      data-source-component={SOURCE_COMPONENT}
      className={className}
      {...props}
    />
  );
}

interface LegacyTablePartProps {
  dataComponent?: string;
}

function DataTableHeaderRoot({
  dataComponent,
  ...props
}: LegacyTablePartProps & React.ComponentPropsWithoutRef<typeof TableHeader>) {
  if (dataComponent) {
    return <TableHeader data-component={dataComponent} {...props} />;
  }

  return <TableHeader data-component="desktop_v3_data-table_header" {...props} />;
}

function DataTableBodyRoot({
  dataComponent,
  ...props
}: LegacyTablePartProps & React.ComponentPropsWithoutRef<typeof TableBody>) {
  if (dataComponent) {
    return <TableBody data-component={dataComponent} {...props} />;
  }

  return <TableBody data-component="desktop_v3_data-table_body" {...props} />;
}

function DataTableRowRoot({
  dataComponent,
  ...props
}: LegacyTablePartProps & React.ComponentPropsWithoutRef<typeof TableRow>) {
  if (dataComponent) {
    return <TableRow data-component={dataComponent} {...props} />;
  }

  return <TableRow data-component="desktop_v3_data-table_row" {...props} />;
}

export function DataTable<T extends Record<string, unknown>>({
  "data-component": dataComponent,
  data,
  columns,
  isLoading = false,
  error = null,
  getRowKey,
  searchEnabled = true,
  searchPlaceholder = "검색",
  searchFields = [],
  onSearch,
  searchQuery: controlledSearchQuery,
  filterOptions,
  onFilterChange,
  filterValue: controlledFilterValue,
  filterAddAction,
  pagination = "client",
  totalCount,
  pageSize = 10,
  onPageChange,
  page: controlledPage,
  onRowClick,
  toolbarActions,
  hideToolbar = false,
  emptyMessage = "데이터가 없습니다",
  className,
  sx, // Kept for backward compatibility, ignored
  skeletonRowCount = 5,
}: DataTableProps<T>) {
  void sx;

  const [internalPage, setInternalPage] = useState(0);
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [internalFilterValue, setInternalFilterValue] = useState<string | null>(null);

  const currentPage = controlledPage ?? internalPage;
  const currentSearchQuery = controlledSearchQuery ?? internalSearchQuery;
  const currentFilterValue = controlledFilterValue ?? internalFilterValue;

  const filteredData = useMemo(() => {
    if (pagination === "server" || !searchEnabled || !currentSearchQuery.trim()) {
      return data;
    }

    return data.filter((row) => {
      const fieldsToSearch = searchFields.length > 0
        ? searchFields
        : (Object.keys(row) as (keyof T)[]);

      const values = fieldsToSearch.map((field): SearchableValue => {
        const value = row[field];
        return typeof value === "string" || typeof value === "number" ? value : null;
      });

      return matchesSearchQuery(currentSearchQuery, values);
    });
  }, [data, currentSearchQuery, searchEnabled, searchFields, pagination]);

  const paginatedData = useMemo(() => {
    if (pagination !== "client") {
      return filteredData;
    }

    const startIndex = currentPage * pageSize;
    const endIndex = startIndex + pageSize;
    return filteredData.slice(startIndex, endIndex);
  }, [filteredData, currentPage, pageSize, pagination]);

  const handleSearchChange = (query: string) => {
    if (onSearch) {
      onSearch(query);
    } else {
      setInternalSearchQuery(query);
    }

    if (onPageChange) {
      onPageChange(0);
    } else {
      setInternalPage(0);
    }
  };

  const handleFilterChange = (value: string | null) => {
    if (onFilterChange) {
      onFilterChange(value);
    } else {
      setInternalFilterValue(value);
    }

    if (onPageChange) {
      onPageChange(0);
    } else {
      setInternalPage(0);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (onPageChange) {
      onPageChange(newPage);
    } else {
      setInternalPage(newPage);
    }
  };

  const paginationCount = useMemo(() => {
    if (pagination === "server") {
      return totalCount ?? 0;
    }
    return filteredData.length;
  }, [pagination, totalCount, filteredData.length]);

  // Helper to get alignment class
  const getAlignClass = (align?: "left" | "center" | "right") => {
    switch (align) {
      case "left":
        return "text-left";
      case "right":
        return "text-right";
      case "center":
      default:
        return "text-center";
    }
  };

  if (error) {
    return (
      <div
        data-component={dataComponent}
        data-source-component={SOURCE_COMPONENT}
        className={cn("p-3", className)}
      >
        <Alert variant="destructive">
          <AlertDescription>
            {error.message || "데이터를 불러오는데 실패했습니다"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <DataTableRoot dataComponent={dataComponent} className={className}>
      {!hideToolbar && (
        <>
          <DataTableToolbar
            searchEnabled={searchEnabled}
            searchPlaceholder={searchPlaceholder}
            searchQuery={currentSearchQuery}
            onSearchChange={handleSearchChange}
            filterOptions={filterOptions}
            filterValue={currentFilterValue}
            onFilterChange={handleFilterChange}
            filterAddAction={filterAddAction}
            actions={toolbarActions}
          />
          <Separator />
        </>
      )}

      <div className="min-h-[200px] w-full">
        {paginatedData.length > 0 || isLoading ? (
          <>
            <Table className="table-fixed w-full">
              <DataTableHeaderRoot
                dataComponent={dataComponent ? `${dataComponent}_header` : undefined}
              >
                <TableRow>
                  {columns.map((column, index) => (
                    <TableHead
                      key={`header-${column.key as string}-${index}`}
                      className={cn(
                        "whitespace-nowrap",
                        getAlignClass(column.align)
                      )}
                      style={{ width: column.width }}
                    >
                      {column.header}
                    </TableHead>
                  ))}
                </TableRow>
              </DataTableHeaderRoot>
              <DataTableBodyRoot
                dataComponent={dataComponent ? `${dataComponent}_body` : undefined}
              >
                {isLoading &&
                  Array.from({ length: skeletonRowCount }).map((_, rowIndex) => (
                    <TableRow key={`skeleton-${rowIndex}`}>
                      {columns.map((column, colIndex) => (
                        <TableCell
                          key={`skeleton-cell-${rowIndex}-${colIndex}`}
                          className={getAlignClass(column.align)}
                        >
                          <Skeleton className="h-4 w-[60%] mx-auto" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}

                {!isLoading &&
                  paginatedData.map((row, rowIndex) => (
                    <DataTableRowRoot
                      dataComponent={dataComponent ? `${dataComponent}_row` : undefined}
                      key={getRowKey(row, rowIndex)}
                      onClick={() => onRowClick?.(row, rowIndex)}
                      className={cn(
                        "transition-all duration-200 opacity-0 animate-fade-in",
                        onRowClick && "cursor-pointer hover:bg-muted/50"
                      )}
                      style={{ animationDelay: `${150 + rowIndex * 30}ms` }}
                    >
                      {columns.map((column, colIndex) => (
                        <TableCell
                          key={`cell-${getRowKey(row, rowIndex)}-${colIndex}`}
                          className={cn(
                            "whitespace-nowrap",
                            colIndex === 0 ? "font-medium" : "text-muted-foreground",
                            getAlignClass(column.align)
                          )}
                        >
                          {column.render
                            ? column.render(row, rowIndex)
                            : String(row[column.key as keyof T] ?? "")}
                        </TableCell>
                      ))}
                    </DataTableRowRoot>
                  ))}
              </DataTableBodyRoot>
            </Table>

            {pagination !== "none" && (
              <DataTablePagination
                data-component={dataComponent ? `${dataComponent}_pagination` : undefined}
                count={paginationCount}
                page={currentPage}
                rowsPerPage={pageSize}
                onPageChange={handlePageChange}
                disabled={isLoading}
              />
            )}
          </>
        ) : (
          <div className="py-3">
            <Alert>
              <AlertDescription>{emptyMessage}</AlertDescription>
            </Alert>
          </div>
        )}
      </div>
    </DataTableRoot>
  );
}
