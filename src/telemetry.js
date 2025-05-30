const opentelemetry = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { LoggerProvider, SimpleLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis');

async function setupTelemetry() {
    const resource = new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'product-inventory-api',
        [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    });

    const traceExporter = new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/traces',
    });

    const metricExporter = new OTLPMetricExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/metrics',
    });

    const logExporter = new OTLPLogExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/logs',
    });

    const sdk = new NodeSDK({
        resource,
        traceExporter,
        metricReader: new PeriodicExportingMetricReader({
            exporter: metricExporter,
            exportIntervalMillis: 1000,
        }),
        instrumentations: [
            getNodeAutoInstrumentations(),
            new PgInstrumentation(),
            new RedisInstrumentation()
        ],
    });

    const loggerProvider = new LoggerProvider({
        resource,
    });

    loggerProvider.addLogRecordProcessor(
        new SimpleLogRecordProcessor(logExporter)
    );

    try {
        // Start the SDK
        await sdk.start();
        console.log('Tracing initialized');

        // Gracefully shut down the SDK on process exit
        process.on('SIGTERM', () => {
            sdk.shutdown()
                .then(() => console.log('Tracing terminated'))
                .catch((error) => console.log('Error terminating tracing', error))
                .finally(() => process.exit(0));
        });

        return { sdk, loggerProvider };
    } catch (error) {
        console.error('Error initializing tracing:', error);
        throw error;
    }
}

module.exports = { setupTelemetry }; 