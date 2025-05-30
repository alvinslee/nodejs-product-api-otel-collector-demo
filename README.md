# OpenTelemetry Product Inventory API

This is a demo application that showcases OpenTelemetry instrumentation in a Node.js Express application. The application is a simple product inventory API that uses PostgreSQL for data storage and Redis for caching.

## Features

- OpenTelemetry instrumentation for traces and logs
- Express.js REST API
- PostgreSQL database
- Redis caching with 60-minute TTL
- Docker containerization
- Docker Compose orchestration

## Prerequisites

- Docker
- Docker Compose

## Project Structure

```
.
├── Dockerfile
├── docker-compose.yml
├── package.json
├── src/
│   ├── index.js
│   ├── db.js
│   ├── logger.js
│   └── telemetry.js
├── init.sql
├── otel-collector-config.yaml
├── demo.sh
└── demo_continuous.sh
```

## API Endpoints

- `GET /api/products` - Get all products (with optional category and minQuantity filters)
- `GET /api/products/:id` - Get a single product by ID
- `POST /api/products` - Create a new product
- `PUT /api/products/:id` - Update a product
- `DELETE /api/products/:id` - Delete a product
- `PATCH /api/products/:id/quantity` - Update product quantity

## Getting Started

1. Clone the repository
2. Start the services using Docker Compose:

```bash
docker-compose up --build
```

The application will be available at `http://localhost:3000`.

## OpenTelemetry Integration

The application is instrumented with OpenTelemetry for:

- Distributed tracing
- Logging

The OpenTelemetry collector is configured to:
- Receive telemetry data via OTLP (HTTP and gRPC)
- Export telemetry data to SolarWinds Observability
- Export debug logs to console

## Environment Variables

The following environment variables can be configured:

- `NODE_ENV` - Environment (development/production)
- `PORT` - Application port (default: 3000)
- `POSTGRES_HOST` - PostgreSQL host
- `POSTGRES_PORT` - PostgreSQL port
- `POSTGRES_USER` - PostgreSQL user
- `POSTGRES_PASSWORD` - PostgreSQL password
- `POSTGRES_DB` - PostgreSQL database name
- `REDIS_HOST` - Redis host
- `REDIS_PORT` - Redis port
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OpenTelemetry collector endpoint
- `API_TOKEN` - SolarWinds Observability API token

## Caching Strategy

- Product queries are cached in Redis for 60 minutes
- Cache is invalidated on any write operation (create, update, delete)
- Cache keys are based on query parameters

## Demo Scripts

The repository includes two demo scripts to help test and demonstrate the API's functionality and telemetry:

### Basic Demo (`demo.sh`)
- Runs a set of API operations 5 times
- Demonstrates basic CRUD operations, caching behavior, and filtering
- Shows telemetry in action
- Perfect for quick testing and demonstration

### Continuous Demo (`demo_continuous.sh`)
- Runs API operations continuously with 1-2 second delays between actions
- Ideal for long-running tests and monitoring
- Includes random variations in product quantities
- Maintains running statistics of all operations
- Can be stopped at any time with Ctrl+C

To run either demo:
```bash
# For the basic demo
./demo.sh

# For the continuous demo
./demo_continuous.sh
```

## Monitoring

The application provides comprehensive monitoring through multiple channels:

### OpenTelemetry Metrics
- Collector metrics available at `http://localhost:8888/metrics`
- Includes request counts, latencies, and error rates
- Real-time metrics visualization in SolarWinds Observability

### Distributed Tracing
- End-to-end request tracing across all services
- Trace visualization in SolarWinds Observability
- Includes cache hits/misses and database operations
- Custom spans for business operations

### Logging
- Structured logging with OpenTelemetry
- Log correlation with traces
- Console output for local debugging
- Log aggregation in SolarWinds Observability

### Demo Statistics
When running the demo scripts, you can monitor:
- Total operations performed
- Cache hit/miss rates
- API response times
- Database operation counts
- Error rates and types

All telemetry data is automatically exported to SolarWinds Observability for:
- Real-time monitoring
- Historical analysis
- Alert configuration
- Performance optimization 