"use client";

import { useCallback, useState } from "react";
import { CloudUpload, FileText } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// 허용되는 파일 형식
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
const ALLOWED_EXTENSIONS = ".png, .jpg, .jpeg, .pdf";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface ImageDropzoneProps {
  onFileSelect: (file: File) => void;
  isLoading?: boolean;
  error?: string | null;
}

export function ImageDropzone({
  onFileSelect,
  isLoading = false,
  error,
}: ImageDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const validateFile = useCallback((file: File): string | null => {
    // 파일 형식 검증
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `허용되지 않는 파일 형식입니다. 허용 형식: ${ALLOWED_EXTENSIONS}`;
    }

    // 파일 크기 검증
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(2);
      return `파일 크기가 10MB를 초과합니다. 현재 크기: ${sizeMB}MB`;
    }

    return null;
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const error = validateFile(file);
      if (error) {
        setValidationError(error);
        setSelectedFile(null);
        return;
      }

      setValidationError(null);
      setSelectedFile(file);
      onFileSelect(file);
    },
    [validateFile, onFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

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

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile],
  );

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div data-component="desktop_settings_sections_image-dropzone">
      {/* 에러 표시 */}
      {(validationError || error) && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{validationError || error}</AlertDescription>
        </Alert>
      )}

      {/* 드롭존 */}
      <div
        data-component="desktop_settings_sections_image-dropzone_paper"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative p-8 border-2 border-dashed rounded-[24px] transition-all duration-200",
          isDragOver
            ? "border-primary bg-primary/5"
            : validationError
              ? "border-destructive bg-destructive/5"
              : "border-border bg-background",
          isLoading ? "cursor-wait" : "cursor-pointer",
          !isLoading && "hover:border-primary hover:bg-muted/50"
        )}
      >
        <input
          type="file"
          accept={ALLOWED_EXTENSIONS}
          onChange={handleFileInputChange}
          disabled={isLoading}
          className={cn(
            "absolute inset-0 w-full h-full opacity-0",
            isLoading ? "cursor-wait" : "cursor-pointer"
          )}
        />

        <div className="flex flex-col items-center gap-4 relative">
          {isLoading ? (
            <>
              <Spinner className="h-12 w-12" />
              <p className="text-muted-foreground">이미지 분석 중...</p>
            </>
          ) : selectedFile ? (
            <>
              <FileText className="h-12 w-12 text-primary" />
              <div className="text-center">
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                다른 파일을 선택하려면 클릭하거나 드래그하세요
              </p>
            </>
          ) : (
            <>
              <CloudUpload className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">바우처 요금표 이미지를 업로드하세요</p>
                <p className="text-sm text-muted-foreground">
                  드래그 앤 드롭 또는 클릭하여 파일 선택
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                지원 형식: PNG, JPG, JPEG, PDF (최대 10MB)
              </p>
            </>
          )}
        </div>
      </div>

      {/* 업로드 가이드 */}
      <div className="mt-3 pl-1">
        <p className="text-xs text-muted-foreground font-semibold">업로드 가이드:</p>
        <ul className="text-xs text-muted-foreground mt-1 pl-4 list-disc space-y-0.5">
          <li>표 전체가 보이도록 캡처해주세요</li>
          <li>단위 표시(천원/원)가 포함되어야 합니다</li>
          <li>단축, 표준, 연장 헤더가 보여야 합니다</li>
        </ul>
      </div>
    </div>
  );
}
