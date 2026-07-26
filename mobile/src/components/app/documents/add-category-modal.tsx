"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface AddCategoryModalProps {
  /** Caller-context canonical base for this surface. */
  "data-component": string;
  open: boolean;
  onClose: () => void;
  onAdd: (category: {
    value: string;
    label: string;
    color: string;
  }) => Promise<void>;
  existingColors: string[];
  isLoading?: boolean;
}

// Color options using design system CSS variables where possible
const COLOR_OPTIONS = [
  // Design system semantic colors
  { value: "default", label: "기본", hex: "hsl(var(--muted-foreground))" },
  { value: "primary", label: "네이비", hex: "hsl(var(--primary))" },
  { value: "accent", label: "파랑", hex: "hsl(var(--accent))" },
  { value: "success", label: "초록", hex: "hsl(var(--success))" },
  { value: "warning", label: "주황", hex: "hsl(var(--warning))" },
  { value: "error", label: "빨강", hex: "hsl(var(--destructive))" },
  { value: "info", label: "하늘", hex: "hsl(var(--info))" },
  // Additional palette colors for variety
  { value: "#e91e63", label: "핑크", hex: "#e91e63" },
  { value: "#9c27b0", label: "보라", hex: "#9c27b0" },
  { value: "#00bcd4", label: "청록", hex: "#00bcd4" },
  { value: "#795548", label: "갈색", hex: "#795548" },
  { value: "#607d8b", label: "회청", hex: "#607d8b" },
];

export function AddCategoryModal({
  "data-component": dataComponent,
  open,
  onClose,
  onAdd,
  existingColors,
  isLoading = false,
}: AddCategoryModalProps) {
  const [name, setName] = useState("");
  const [selectedColor, setSelectedColor] = useState("");

  const handleClose = () => {
    if (isLoading) return;
    setName("");
    setSelectedColor("");
    onClose();
  };

  const handleAdd = async () => {
    if (!name.trim() || !selectedColor || isLoading) return;

    const value = name.trim().toLowerCase().replace(/\s+/g, "-");
    await onAdd({
      value,
      label: name.trim(),
      color: selectedColor,
    });
    setName("");
    setSelectedColor("");
  };

  // Filter out already used colors
  const availableColors = COLOR_OPTIONS.filter(
    (color) => !existingColors.includes(color.value)
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => !isOpen && handleClose()}>
        <DialogContent data-component={dataComponent} className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader data-component={`${dataComponent}_header`} className="flex-row justify-between items-center">
          <DialogTitle>태그 추가</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div data-component={`${dataComponent}_form`} className="flex flex-col gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="category-name">태그 이름</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="예: 중요문서"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">칩 색상 선택</Label>
            <div className="flex flex-wrap gap-3">
              {availableColors.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setSelectedColor(color.value)}
                  className={cn(
                    "w-12 h-12 rounded-2xl cursor-pointer transition-all duration-200",
                    "hover:scale-110 hover:shadow-md",
                    selectedColor === color.value
                      ? "ring-2 ring-offset-2 ring-foreground"
                      : "border-2 border-transparent"
                  )}
                  style={{ backgroundColor: color.hex }}
                  title={color.label}
                />
              ))}
            </div>
            {selectedColor && (
              <p className="text-xs text-muted-foreground mt-2">
                선택됨:{" "}
                {COLOR_OPTIONS.find((c) => c.value === selectedColor)?.label}
              </p>
            )}
          </div>
        </div>

        <DialogFooter data-component={`${dataComponent}_footer`}>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            취소
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!name.trim() || !selectedColor || isLoading}
          >
            {isLoading ? "추가 중..." : "추가"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
