export interface ContractDataDto {
    customerName: string;
    customerContact: string;
    customerDOB: string;
    customerAddress: string;
    caretaker1Name: string;
    caretaker1Contact: string;
    type: string;
    days: string;
    area: string;
    contractDuration: string;
    startYear: string;
    startMonth: string;
    startDay: string;
    startDate: string;
    endYear: string;
    endMonth: string;
    endDay: string;
    endDate: string;
    paymentYear: string;
    paymentMonth: string;
    paymentDay: string;
    receiptYear: string;
    receiptMonth: string;
    receiptDay: string;
    fullPrice: string;
    grant: string;
    actualPrice: string;
}
export interface EformsignTokenResponse {
    oauth_token: {
        access_token: string;
        refresh_token: string;
    };
}
