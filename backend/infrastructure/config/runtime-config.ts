interface RuntimeEnvironment {
    APP_HOST?: string;
    APP_PORT?: string;
}

interface RuntimeNetworkConfig {
    host: string;
    port: number;
}

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3001;

export function resolveRuntimeNetworkConfig(
    environment: RuntimeEnvironment,
): RuntimeNetworkConfig {
    const rawPort = environment.APP_PORT?.trim();
    const port = rawPort ? Number(rawPort) : DEFAULT_PORT;

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error("APP_PORT must be an integer between 1 and 65535");
    }

    return {
        host: environment.APP_HOST?.trim() || DEFAULT_HOST,
        port,
    };
}
