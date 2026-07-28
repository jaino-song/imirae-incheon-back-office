"use client";

import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { getDataSourceById } from "@/lib/template/data-sources";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DynamicSelectProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  optionType?: "custom" | "dataSource";
  options?: string[];
  dataSourceId?: string;
}

export const DynamicSelect = ({
  value,
  onChange,
  label,
  required,
  optionType,
  options,
  dataSourceId,
}: DynamicSelectProps) => {
  const dataSource = dataSourceId
    ? getDataSourceById(dataSourceId)
    : undefined;

  const { data: remoteOptions, isLoading } = useQuery({
    queryKey: ["data-source", dataSourceId],
    queryFn: async () => {
      if (!dataSource) return [];
      const { data } = await api.get(dataSource.endpoint);
      return data;
    },
    enabled: optionType === "dataSource" && !!dataSource,
  });

  const renderOptions = () => {
    if (optionType === "custom" && options) {
      return options.map((opt) => (
        <SelectItem key={opt} value={opt}>
          {opt}
        </SelectItem>
      ));
    }

    if (optionType === "dataSource" && remoteOptions && dataSource) {
      return remoteOptions.map((item: Record<string, string>) => (
        <SelectItem
          key={item[dataSource.valueField]}
          value={item[dataSource.valueField]}
        >
          {item[dataSource.labelField]}
        </SelectItem>
      ));
    }

    return null;
  };

  return (
    <div className="space-y-2" data-component="desktop_messages_sections_form-dynamic-select">
      <Label>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={isLoading} required={required}>
        <SelectTrigger>
          {isLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-muted-foreground">로딩 중...</span>
            </div>
          ) : (
            <SelectValue placeholder="선택하세요" />
          )}
        </SelectTrigger>
        <SelectContent>{renderOptions()}</SelectContent>
      </Select>
    </div>
  );
};
