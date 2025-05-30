const winston = require('winston');
const { LoggerProvider, SimpleLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

// Create OpenTelemetry LoggerProvider
const loggerProvider = new LoggerProvider({
    resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'product-inventory-api',
        [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development'
    }),
});

// Create OTLP Log Exporter
const logExporter = new OTLPLogExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/logs',
    headers: {
        'Authorization': `Bearer ${process.env.API_TOKEN}`
    }
});

// Add the log processor to the logger provider
loggerProvider.addLogRecordProcessor(
    new SimpleLogRecordProcessor(logExporter)
);

// Get the OpenTelemetry logger
const otelLogger = loggerProvider.getLogger('product-inventory-api');

// Create Winston logger for console output
const winstonLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, ...meta }) => {
            return JSON.stringify({
                timestamp,
                level,
                ...meta
            }, null, 2);
        })
    ),
    defaultMeta: { service: 'product-inventory-api' },
    transports: [
        new winston.transports.Console()
    ]
});

// Create a combined logger that sends to both Winston and OpenTelemetry
const logger = {
    info: (logData) => {
        const logObject = typeof logData === 'string' ? { message: logData } : logData;
        winstonLogger.info(logObject);
        otelLogger.emit({
            severityText: 'INFO',
            body: JSON.stringify(logObject),
            attributes: {
                ...logObject,
                logLevel: 'info',
                environment: process.env.NODE_ENV || 'development'
            }
        });
    },
    error: (logData) => {
        const logObject = typeof logData === 'string' ? { message: logData } : logData;
        winstonLogger.error(logObject);
        otelLogger.emit({
            severityText: 'ERROR',
            body: JSON.stringify(logObject),
            attributes: {
                ...logObject,
                logLevel: 'error',
                environment: process.env.NODE_ENV || 'development'
            }
        });
    },
    warn: (logData) => {
        const logObject = typeof logData === 'string' ? { message: logData } : logData;
        winstonLogger.warn(logObject);
        otelLogger.emit({
            severityText: 'WARN',
            body: JSON.stringify(logObject),
            attributes: {
                ...logObject,
                logLevel: 'warn',
                environment: process.env.NODE_ENV || 'development'
            }
        });
    },
    debug: (logData) => {
        const logObject = typeof logData === 'string' ? { message: logData } : logData;
        winstonLogger.debug(logObject);
        otelLogger.emit({
            severityText: 'DEBUG',
            body: JSON.stringify(logObject),
            attributes: {
                ...logObject,
                logLevel: 'debug',
                environment: process.env.NODE_ENV || 'development'
            }
        });
    }
};

module.exports = { logger, loggerProvider }; 