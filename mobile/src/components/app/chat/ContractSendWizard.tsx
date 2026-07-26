"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { FileCheck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClientAutocomplete } from "../clients/ClientAutocomplete";
import { useFormStore } from "@/stores/form-store";
import type { Client } from "@/lib/client/types";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";

function formatDueDate(dateStr: string | null): string {
    return formatDateForDisplay(dateStr, "");
}

interface ContractSendWizardProps {
    onComplete?: () => void;
}

export default function ContractSendWizard({ onComplete }: ContractSendWizardProps) {
    const router = useRouter();
    const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);

    const {
        setClientId,
        setName,
        setPhone,
        setBirthday,
        setAddress,
        setDueDate,
        setIsManualEntry,
    } = useFormStore();

    const handleClientChange = useCallback((clientId: number | null, client: Client | null) => {
        setSelectedClientId(clientId);
        setSelectedClient(client);
    }, []);

    const handleSendContract = useCallback(() => {
        if (!selectedClient) return;

        setClientId(selectedClient.id);
        setName(selectedClient.name);
        setPhone(selectedClient.phone || "");
        setBirthday(selectedClient.birthday || "");
        setAddress(selectedClient.address || "");
        setDueDate(selectedClient.dueDate || "");
        setIsManualEntry(false);

        router.push("/messages");
        onComplete?.();
    }, [selectedClient, setClientId, setName, setPhone, setBirthday, setAddress, setDueDate, setIsManualEntry, router, onComplete]);

    return (
        <div data-component="chat-wizard-contract-send" className="min-h-[300px] flex flex-col">
            <div className="mb-4">
                <h3 className="text-base font-bold mb-1">
                    계약서 전송
                </h3>
                <p className="text-sm text-muted-foreground">
                    계약서를 보낼 산모를 선택해주세요.
                </p>
            </div>

            <div data-component="chat-wizard-contract-send-body" className="flex flex-col gap-6 flex-1">
                <ClientAutocomplete
                    data-component="mobile_chat_contract-send-wizard_body_client-autocomplete"
                    value={selectedClientId}
                    onChange={handleClientChange}
                    label="산모 선택"
                    required
                />

                <div>
                    <div
                        className="flex flex-col gap-3 pl-4 border-l-[3px] mb-6"
                        style={{
                            borderColor: selectedClient
                                ? "hsl(var(--primary))"
                                : "hsl(var(--muted-foreground) / 0.3)"
                        }}
                    >
                        <div className="flex items-center gap-2 min-h-[24px]">
                            {selectedClient && (
                                <>
                                    <span className="text-base font-semibold">
                                        {selectedClient.name}
                                    </span>
                                    {selectedClient.hasSigned && (
                                        <Badge
                                            variant="outline"
                                            className="text-success border-success h-5 text-[0.7rem]"
                                        >
                                            <FileCheck className="w-3.5 h-3.5 mr-1" />
                                            계약 완료
                                        </Badge>
                                    )}
                                </>
                            )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                            <strong>연락처:</strong> {selectedClient?.phone || ""}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            <strong>주소:</strong> {selectedClient?.address || ""}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            <strong>출산예정일:</strong> {formatDueDate(selectedClient?.dueDate ?? null)}
                        </p>
                    </div>

                    <Button
                        onClick={handleSendContract}
                        className="w-full"
                        size="lg"
                        disabled={!selectedClient}
                    >
                        <Send className="w-4 h-4 mr-2" />
                        계약서 전송하러 가기
                    </Button>
                </div>
            </div>
        </div>
    );
}
