#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Statistics tracking
declare -A stats
stats["get_all"]=0
stats["get_filtered"]=0
stats["get_specific"]=0
stats["create"]=0
stats["update"]=0
stats["cache_clear"]=0

# Counter for cycles and stats printing
cycle_count=0
STATS_INTERVAL=5  # Print stats every 5 cycles

# Function to handle script termination
cleanup() {
    echo -e "\n${YELLOW}Script interrupted. Printing final statistics...${NC}"
    print_stats
    echo -e "\n${GREEN}Demo stopped after $cycle_count cycles${NC}"
    exit 0
}

# Set up trap for Ctrl+C
trap cleanup SIGINT SIGTERM

# Function to print section headers
print_header() {
    echo -e "\n${BLUE}=== $1 ===${NC}\n"
}

# Function to make a request and show timing
make_request() {
    echo -e "${YELLOW}Request: $1${NC}"
    time curl -s "$1" | jq '.'
    echo
}

# Function to make a POST/PUT/PATCH request
make_mutate_request() {
    echo -e "${YELLOW}Request: $1${NC}"
    echo -e "${YELLOW}Body: $2${NC}"
    time curl -s -X "$3" \
        -H "Content-Type: application/json" \
        -d "$2" \
        "$1" | jq '.'
    echo
}

# Function to print statistics
print_stats() {
    print_header "Operation Statistics"
    echo "Total operations performed:"
    echo "Get All Products: ${stats[get_all]}"
    echo "Get Filtered Products: ${stats[get_filtered]}"
    echo "Get Specific Product: ${stats[get_specific]}"
    echo "Create Product: ${stats[create]}"
    echo "Update Product: ${stats[update]}"
    echo "Cache Clear: ${stats[cache_clear]}"
    echo -e "\nTotal cycles completed: $cycle_count"
}

# Function to sleep for a random duration between 1-2 seconds
random_sleep() {
    sleep_duration=$(awk -v min=1 -v max=2 'BEGIN{srand(); print min+rand()*(max-min)}')
    echo -e "${GREEN}Sleeping for ${sleep_duration} seconds...${NC}"
    sleep $sleep_duration
}

print_header "Starting Continuous API Demo"
echo "This script will demonstrate:"
echo "1. Basic CRUD operations"
echo "2. Caching behavior"
echo "3. Filtering capabilities"
echo "4. Cache clearing"
echo "5. Telemetry in action"
echo "Running continuously with 1-2 second delays between actions"
echo "Statistics will be printed every $STATS_INTERVAL cycles"
echo "Press Ctrl+C to stop the demo and see final statistics"
echo

# Counter for product creation
product_counter=1

# Run the demo continuously
while true; do
    ((cycle_count++))
    print_header "Starting Cycle #$cycle_count"
    
    # 1. Get all products
    print_header "1. Get all products (initial request - will hit database)"
    make_request "http://localhost:3000/api/products"
    ((stats[get_all]++))
    random_sleep

    # 2. Get all products again (should hit cache)
    print_header "2. Get all products again (should hit cache)"
    make_request "http://localhost:3000/api/products"
    ((stats[get_all]++))
    random_sleep

    # 3. Get products filtered by category
    print_header "3. Get products filtered by category"
    make_request "http://localhost:3000/api/products?category=Electronics"
    ((stats[get_filtered]++))
    random_sleep

    # 4. Get products with minimum quantity
    print_header "4. Get products with minimum quantity"
    make_request "http://localhost:3000/api/products?minQuantity=50"
    ((stats[get_filtered]++))
    random_sleep

    # 5. Get a specific product
    print_header "5. Get a specific product (will hit database)"
    make_request "http://localhost:3000/api/products/1"
    ((stats[get_specific]++))
    random_sleep

    # 6. Get the same product again (should hit cache)
    print_header "6. Get the same product again (should hit cache)"
    make_request "http://localhost:3000/api/products/1"
    ((stats[get_specific]++))
    random_sleep

    # 7. Create a new product
    print_header "7. Create a new product"
    make_mutate_request "http://localhost:3000/api/products" \
        "{\"name\": \"Demo Product $product_counter\", \"description\": \"Created during continuous demo run $product_counter\", \"category\": \"Electronics\", \"price\": 199.99, \"quantity\": 100}" \
        "POST"
    ((stats[create]++))
    ((product_counter++))
    random_sleep

    # 8. Get all products
    print_header "8. Get all products (should show new product)"
    make_request "http://localhost:3000/api/products"
    ((stats[get_all]++))
    random_sleep

    # 9. Update the product quantity
    print_header "9. Update the product quantity"
    make_mutate_request "http://localhost:3000/api/products/1/quantity" \
        "{\"quantity\": $((75 + RANDOM % 50))}" \
        "PATCH"
    ((stats[update]++))
    random_sleep

    # 10. Get the updated product
    print_header "10. Get the updated product"
    make_request "http://localhost:3000/api/products/1"
    ((stats[get_specific]++))
    random_sleep

    # 11. Get all products
    print_header "11. Get all products"
    make_request "http://localhost:3000/api/products"
    ((stats[get_all]++))
    random_sleep

    # 12. Clear the cache
    print_header "12. Clear the cache"
    make_mutate_request "http://localhost:3000/api/cache" "" "DELETE"
    ((stats[cache_clear]++))
    random_sleep

    # 13. Get all products again
    print_header "13. Get all products again (will hit database after cache clear)"
    make_request "http://localhost:3000/api/products"
    ((stats[get_all]++))
    random_sleep

    # 14. Get a specific product
    print_header "14. Get a specific product (will hit database after cache clear)"
    make_request "http://localhost:3000/api/products/1"
    ((stats[get_specific]++))
    random_sleep

    # 15. Get the same product again
    print_header "15. Get the same product again (should hit cache)"
    make_request "http://localhost:3000/api/products/1"
    ((stats[get_specific]++))
    random_sleep

    # Print statistics every STATS_INTERVAL cycles
    if (( cycle_count % STATS_INTERVAL == 0 )); then
        print_stats
        echo -e "${GREEN}Completed $cycle_count cycles. Continuing...${NC}"
        echo
    else
        echo -e "${GREEN}Completed cycle #$cycle_count. Starting next cycle...${NC}"
        echo
    fi
done 