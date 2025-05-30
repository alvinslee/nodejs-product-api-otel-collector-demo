const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { metrics } = require('@opentelemetry/api');
const os = require('os');

// Create OTLP Metric Exporter
const metricExporter = new OTLPMetricExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT + '/v1/metrics',
    headers: {
        'Authorization': `Bearer ${process.env.API_TOKEN}`
    }
});

// Create a meter provider with the exporter
const meterProvider = new MeterProvider({
    resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'product-inventory-api',
        [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development'
    })
});

// Register the metric exporter with a periodic reader
meterProvider.addMetricReader(new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 1000 // Export metrics every second
}));

// Set the global meter provider
metrics.setGlobalMeterProvider(meterProvider);

// Get a meter instance
const meter = metrics.getMeter('product-inventory-api');

// Create metrics
const requestCounter = meter.createCounter('http.requests.total', {
    description: 'Total number of HTTP requests',
    unit: '1'
});

const errorCounter = meter.createCounter('http.errors.total', {
    description: 'Total number of HTTP errors',
    unit: '1'
});

const requestDuration = meter.createHistogram('http.request.duration', {
    description: 'HTTP request duration in milliseconds',
    unit: 'ms'
});

const dbQueryDuration = meter.createHistogram('db.query.duration', {
    description: 'Database query duration in milliseconds',
    unit: 'ms'
});

const cacheOperationDuration = meter.createHistogram('cache.operation.duration', {
    description: 'Cache operation duration in milliseconds',
    unit: 'ms'
});

const cacheHitCounter = meter.createCounter('cache.hits.total', {
    description: 'Total number of cache hits',
    unit: '1'
});

const cacheMissCounter = meter.createCounter('cache.misses.total', {
    description: 'Total number of cache misses',
    unit: '1'
});

// System metrics
const cpuUsage = meter.createObservableGauge('system.cpu.usage', {
    description: 'CPU usage percentage',
    unit: '%'
});

const memoryUsage = meter.createObservableGauge('system.memory.usage', {
    description: 'Memory usage in bytes',
    unit: 'bytes'
});

// Register system metrics using individual callbacks
cpuUsage.addCallback((result) => {
    const cpuUsagePercent = os.loadavg()[0] * 100 / os.cpus().length;
    result.observe(cpuUsagePercent, {
        type: 'process'
    });
});

memoryUsage.addCallback((result) => {
    const memUsage = process.memoryUsage();
    result.observe(memUsage.heapUsed, {
        type: 'heap'
    });
    result.observe(memUsage.rss, {
        type: 'rss'
    });
});

// Create a middleware to track HTTP metrics
const metricsMiddleware = (req, res, next) => {
    const startTime = Date.now();
    const path = req.route?.path || req.path;
    const method = req.method;
    
    // Increment request counter
    requestCounter.add(1, {
        method,
        path,
        status: 'pending'
    });
    
    // Track response
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const status = res.statusCode;
        
        // Record request duration
        requestDuration.record(duration, {
            method,
            path,
            status: status.toString()
        });
        
        // Update request counter with final status
        requestCounter.add(1, {
            method,
            path,
            status: status.toString()
        });
        
        // Increment error counter for 4xx and 5xx status codes
        if (status >= 400) {
            errorCounter.add(1, {
                method,
                path,
                status: status.toString()
            });
        }
    });
    
    next();
};

module.exports = {
    meter,
    requestCounter,
    errorCounter,
    requestDuration,
    dbQueryDuration,
    cacheOperationDuration,
    cacheHitCounter,
    cacheMissCounter,
    metricsMiddleware
}; 