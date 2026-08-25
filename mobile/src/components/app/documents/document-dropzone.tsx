"use client";

import { useCallback, useState, useEffect } from "react";
import { useDocumentCategories } from "@/hooks/use-document-categories";
import { CloudUpload, FileText, X, ImageIcon, File, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import type { DocumentVisibilityScope } from "@babyjamjam/shared/file-storage";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/pdf",
];
const ALLOWED_EXTENSIONS = ".png, .jpg, .jpeg, .pdf";
const MAX_FILE_SIZE = 25 * 1024 * 1024;

interface DocumentDropzoneProps {
  /** Caller-context canonical base for this surface. */
  "data-component": string;
  onUpload: (params: {
    file: File;
    name: string;
    description?: string;
    categoryId: string;
    tags: string[];
    visibilityScope: DocumentVisibilityScope;
  }) => Promise<void>;
  isLoading?: boolean;
  uploadProgress?: number;
}

export function DocumentDropzone({
  "data-component": dataComponent,
  onUpload,
  isLoading = false,
  uploadProgress = 0,
}: DocumentDropzoneProps) {
  const canPublishToAllBranches = true;
  const [publishToAllBranches, setPublishToAllBranches] = useState(canPublishToAllBranches);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const { data: categories = [] } = useDocumentCategories();

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const validateFile = useCallback((file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `허용되지 않는 파일 형식입니다. 허용 형식: ${ALLOWED_EXTENSIONS}`;
    }

    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(2);
      return `파일 크기가 25MB를 초과합니다. 현재 크기: ${sizeMB}MB`;
    }

    return null;
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const error = validateFile(file);
      if (error) {
        setValidationError(error);
        return;
      }

      setValidationError(null);
      setSelectedFile(file);
      setPublishToAllBranches(canPublishToAllBranches);

      const fileNameWithoutExt =
        file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
      setName(fileNameWithoutExt);

      if (file.type.startsWith("image/")) {
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
      } else {
        setPreviewUrl(null);
      }
    },
    [canPublishToAllBranches, validateFile]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isLoading) {
        setIsDragOver(true);
      }
    },
    [isLoading]
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (isLoading) return;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile, isLoading]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleRemoveFile = useCallback(() => {
    setSelectedFile(null);
    setValidationError(null);
    setName("");
    setDescription("");
    setCategory("");
    setTags([]);
    setTagInput("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput("");
    }
  };

  const handleDeleteTag = (tagToDelete: string) => {
    setTags(tags.filter((tag) => tag !== tagToDelete));
  };

  const handleSubmit = async () => {
    if (!selectedFile || !name || !category) return;

    await onUpload({
      file: selectedFile,
      name,
      description: description || undefined,
      categoryId: category,
      tags,
      visibilityScope: publishToAllBranches ? "all_branches" : "branch",
    });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const getFileIcon = () => {
    if (selectedFile?.type === "application/pdf") {
      return <FileText className="h-10 w-10 text-destructive" />;
    }
    if (selectedFile?.type.startsWith("image/")) {
      return <ImageIcon className="h-10 w-10 text-primary" />;
    }
    return <File className="h-10 w-10 text-muted-foreground" />;
  };

  return (
    <div data-component={dataComponent} className="w-full">
      {validationError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      )}

      {!selectedFile ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "relative p-6 border-2 border-dashed rounded-2xl flex flex-col items-center gap-4",
            "transition-all duration-200",
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-border bg-background",
            isLoading ? "cursor-wait" : "cursor-pointer",
            !isLoading && "hover:border-primary hover:bg-primary/5"
          )}
        >
          <Input
            type="file"
            accept={ALLOWED_EXTENSIONS}
            onChange={handleFileInputChange}
            disabled={isLoading}
            className={cn(
              "absolute w-full h-full top-0 left-0 opacity-0",
              isLoading ? "cursor-wait" : "cursor-pointer"
            )}
          />

          <CloudUpload className="h-16 w-16 text-muted-foreground/50" />
          <div className="text-center">
            <h6 className="text-lg font-medium mb-1">
              파일을 드래그하거나 클릭하여 업로드
            </h6>
            <p className="text-sm text-muted-foreground">
              지원 형식: PDF, PNG, JPG (최대 25MB)
            </p>
          </div>
        </div>
      ) : (
        <div className="p-6 border border-border rounded-2xl">
          <div className="flex items-start gap-4 mb-6">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Blob previews are local upload object URLs and cannot be optimized by next/image.
              <img
                src={previewUrl}
                alt="Preview"
                className="w-20 h-20 object-cover rounded-2xl border border-border"
              />
            ) : (
              <div className="w-20 h-20 flex items-center justify-center bg-muted rounded-2xl">
                {getFileIcon()}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{selectedFile.name}</p>
              <p className="text-sm text-muted-foreground">
                {formatFileSize(selectedFile.size)}
              </p>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={handleRemoveFile}
              disabled={isLoading}
              className="shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex min-h-[54px] items-center justify-between gap-3 rounded-[14px] border-[1.5px] border-border bg-background p-3">
              <div>
                <p className="text-sm font-bold leading-tight text-foreground">모든 지점에 공개</p>
                <p className="mt-[3px] text-xs font-semibold text-muted-foreground">
                  {publishToAllBranches ? "모든 지점에서 이 파일을 볼 수 있어요" : "현재 지점에서만 이 파일을 볼 수 있어요"}
                </p>
              </div>
              <Switch
                data-component={`${dataComponent}_visibility-switch`}
                thumbDataComponent={`${dataComponent}_visibility-switch-thumb`}
                checked={publishToAllBranches}
                onCheckedChange={setPublishToAllBranches}
                aria-label="모든 지점에 공개"
                disabled={isLoading || !canPublishToAllBranches}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="doc-name">문서 제목 *</Label>
              <Input
                id="doc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label>카테고리 *</Label>
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
              <Label htmlFor="doc-tags">태그</Label>
              <Input
                id="doc-tags"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleAddTag}
                placeholder="태그 입력 후 Enter"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Enter 키를 눌러 태그를 추가하세요
              </p>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tags.map((tag, index) => (
                    <Badge
                      key={index}
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
              <Label htmlFor="doc-description">설명 (선택사항)</Label>
              <Textarea
                id="doc-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={isLoading}
              />
            </div>

            {isLoading && (
              <div className="w-full">
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-muted-foreground">
                    업로드 중...
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {Math.round(uploadProgress)}%
                  </span>
                </div>
                <Progress value={uploadProgress} />
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={!name || !category || isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  업로드 중...
                </>
              ) : (
                <>
                  <CloudUpload className="h-5 w-5 mr-2" />
                  문서 업로드
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
