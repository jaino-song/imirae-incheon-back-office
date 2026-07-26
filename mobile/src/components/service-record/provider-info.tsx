export const DEFAULT_PROVIDER_NAME = "인천 아이미래로";

interface ProviderInfoProps {
    "data-component"?: string;
    providerName?: string;
}

export function ProviderInfo({
    "data-component": dataComponent,
    providerName = DEFAULT_PROVIDER_NAME,
}: ProviderInfoProps) {
    return (
        <div data-component={dataComponent} className="org">
            {providerName}
        </div>
    );
}
