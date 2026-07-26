"use client";

import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Document } from "@/hooks/use-documents";
import { useDocumentCategories } from "@/hooks/use-document-categories";

interface DocumentEditModalProps {
  open: boolean;
  onClose: () => void;
  doc: Document | null;
  onSave: (
    id: string,
    params: {
      name?: string;
      description?: string;
      categoryId?: string;
      tags?: string[];
    }
  ) => Promise<void>;
  isLoading?: boolean;
}

export function DocumentEditModal({
  open,
  onClose,
  doc,
  onSave,
  isLoading = false,
}: DocumentEditModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const { data: categories = [] } = useDocumentCategories();

  useEffect(() => {
    queueMicrotask(() => {
      if (doc) {
        setName(doc.name || "");
        setDescription(doc.description || "");
        setCategory(doc.categoryId || "");
        setTags(doc.tags || []);
      } else {
        setName("");
        setDescription("");
        setCategory("");
        setTags([]);
      }
      setTagInput("");
    });
  }, [doc]);

  const handleSave = async () => {
    if (!doc) return;

    await onSave(doc.id, {
      name,
      description,
      categoryId: category,
      tags,
    });
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = tagInput.trim();
      if (trimmed && !tags.includes(trimmed)) {
        setTags([...tags, trimmed]);
        setTagInput("");
      }
    }
  };

  const handleDeleteTag = (tagToDelete: string) => {
    setTags(tags.filter((tag) => tag !== tagToDelete));
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => !isOpen && onClose()}>
        <DialogContent data-component="desktop_contracts_document-edit" className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader data-component="desktop_contracts_document-edit_header" className="flex-row justify-between items-center">
          <DialogTitle>문서 정보 수정</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={isLoading}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div data-component="desktop_contracts_document-edit_form" className="flex flex-col gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="doc-name">문서명</Label>
            <Input
              id="doc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>카테고리</Label>
            <Select
              value={category}
              onValueChange={setCategory}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="카테고리 선택" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="doc-tags">태그 (Enter로 추가)</Label>
            <Input
              id="doc-tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              disabled={isLoading}
              placeholder="태그 입력 후 Enter"
            />
            <p className="text-xs text-muted-foreground">
              태그를 입력하고 Enter키를 눌러주세요
            </p>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => !isLoading && handleDeleteTag(tag)}
                  >
                    {tag}
                    <X className="h-3 w-3 ml-1" />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="doc-description">설명</Label>
            <Textarea
              id="doc-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={isLoading}
            />
          </div>
        </div>

        <DialogFooter data-component="desktop_contracts_document-edit_footer">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading ? "저장 중..." : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
