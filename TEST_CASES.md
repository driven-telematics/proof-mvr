# API Validation Test Cases

I created these test cases with Claude to see if my validation code works.

I have fully tested all add-mvr tests and they work flawlessly. 

## 1. POST /add-mvr Tests

### ✅ Test 1.1: Valid Request (Should succeed with 201)
```bash
curl -X POST <API_ENDPOINT>/add-mvr \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_API_KEY>" \
  -d '{
    "company_id": "ACME_CORP_123",
    "permissible_purpose": "UNDERWRITING",
    "price_paid": 25.50,
    "redisclosure_authorization": true,
    "storage_limitations": 1825,
    "mvr": {
      "drivers_license_number": "DL123456789",
      "full_legal_name": "John Doe",
      "birthdate": "1990-05-15",
      "weight": "180",
      "sex": "M",
      "height": "510",
      "hair_color": "Brown",
      "eye_color": "Blue",
      "issued_state_code": "CA",
      "state_code": "CA",
      "medical_information": "None",
      "address": "123 Main St",
      "city": "Los Angeles"
    }
  }'
```

### ❌ Test 1.2: Missing company_id (Should fail with 400)
```json
{
  "permissible_purpose": "UNDERWRITING",
  "price_paid": 25.50,
  "redisclosure_authorization": true,
  "mvr": {
    "drivers_license_number": "DL123456789",
    "full_legal_name": "John Doe",
    "birthdate": "1990-05-15",
    "weight": "180",
    "sex": "M",
    "height": "510",
    "hair_color": "Brown",
    "eye_color": "Blue",
    "issued_state_code": "CA",
    "state_code": "CA"
  }
}
```
**Expected Error:** `company_id is required and cannot be null or undefined`

### ❌ Test 1.3: Empty company_id (Should fail with 400)
```json
{
  "company_id": "",
  "permissible_purpose": "UNDERWRITING",
  "price_paid": 25.50,
  "redisclosure_authorization": true,
  "mvr": { "..." }
}
```
**Expected Error:** `company_id is required and cannot be empty`

### ❌ Test 1.4: company_id with "Other" value (Should fail with 400)
```json
{
  "company_id": "Other",
  "permissible_purpose": "UNDERWRITING",
  "price_paid": 25.50,
  "redisclosure_authorization": true,
  "mvr": { "..." }
}
```
**Expected Error:** `company_id cannot be 'Other'. Please provide a valid value`

### ❌ Test 1.5: Invalid permissible_purpose (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "MARKETING",
  "price_paid": 25.50,
  "redisclosure_authorization": true,
  "mvr": { "..." }
}
```
**Expected Error:** `permissible_purpose must be one of: EMPLOYMENT, INSURANCE, LEGAL, GOVERNMENT, UNDERWRITING, FRAUD`

### ❌ Test 1.6: permissible_purpose as "Other" (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "Other",
  "price_paid": 25.50,
  "redisclosure_authorization": true,
  "mvr": { "..." }
}
```
**Expected Error:** `permissible_purpose cannot be 'Other'. Please provide a valid value`

### ❌ Test 1.7: Missing price_paid (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "redisclosure_authorization": true,
  "mvr": { "..." }
}
```
**Expected Error:** `price_paid is required and cannot be null or undefined`

### ❌ Test 1.8: Negative price_paid (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "price_paid": -10,
  "redisclosure_authorization": true,
  "mvr": { "..." }
}
```
**Expected Error:** `Value must be a non-negative number`

### ❌ Test 1.9: redisclosure_authorization is false (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "price_paid": 25.50,
  "redisclosure_authorization": false,
  "mvr": { "..." }
}
```
**Expected Error:** `redisclosure_authorization is required and must be true`

### ❌ Test 1.10: Missing redisclosure_authorization (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "price_paid": 25.50,
  "mvr": { "..." }
}
```
**Expected Error:** `redisclosure_authorization is required and cannot be null or undefined`

### ❌ Test 1.11: Missing mvr data (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "price_paid": 25.50,
  "redisclosure_authorization": true
}
```
**Expected Error:** `mvr data is required`

### ❌ Test 1.12: Missing drivers_license_number in MVR (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "price_paid": 25.50,
  "redisclosure_authorization": true,
  "mvr": {
    "full_legal_name": "John Doe",
    "birthdate": "1990-05-15",
    "weight": "180",
    "sex": "M",
    "height": "510",
    "hair_color": "Brown",
    "eye_color": "Blue",
    "issued_state_code": "CA",
    "state_code": "CA"
  }
}
```
**Expected Error:** `drivers_license_number is required and cannot be null or undefined`

### ❌ Test 1.13: Empty drivers_license_number (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "price_paid": 25.50,
  "redisclosure_authorization": true,
  "mvr": {
    "drivers_license_number": "",
    "full_legal_name": "John Doe",
    "..."
  }
}
```
**Expected Error:** `drivers_license_number is required and cannot be empty`

### ❌ Test 1.14: "Other" in MVR field (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "price_paid": 25.50,
  "redisclosure_authorization": true,
  "mvr": {
    "drivers_license_number": "DL123456789",
    "full_legal_name": "John Doe",
    "birthdate": "1990-05-15",
    "weight": "180",
    "sex": "Other",
    "height": "510",
    "hair_color": "Brown",
    "eye_color": "Blue",
    "issued_state_code": "CA",
    "state_code": "CA"
  }
}
```
**Expected Error:** `sex cannot be 'Other'. Please provide a valid value`

### ❌ Test 1.15: Multiple validation errors (Should fail with 400)
```json
{
  "company_id": "",
  "permissible_purpose": "Other",
  "price_paid": -5,
  "redisclosure_authorization": false,
  "mvr": {
    "drivers_license_number": "",
    "full_legal_name": "Other",
    "birthdate": "",
    "weight": "",
    "sex": "",
    "height": "",
    "hair_color": "",
    "eye_color": "",
    "issued_state_code": "",
    "state_code": ""
  }
}
```
**Expected Error:** Multiple errors concatenated with semicolons

---

## 2. GET /get-mvr Tests

### ✅ Test 2.1: Valid Request (Should succeed with 200)
```bash
curl -X GET <API_ENDPOINT>/get-mvr \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_API_KEY>" \
  -d '{
    "drivers_license_number": "DL123456789",
    "company_id": "ACME_CORP_123",
    "permissible_purpose": "UNDERWRITING",
    "days": 30,
    "consent": true
  }'
```

### ❌ Test 2.2: Missing drivers_license_number (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "days": 30,
  "consent": true
}
```
**Expected Error:** `drivers_license_number is required and cannot be null or undefined`

### ❌ Test 2.3: Empty drivers_license_number (Should fail with 400)
```json
{
  "drivers_license_number": "",
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "days": 30,
  "consent": true
}
```
**Expected Error:** `drivers_license_number is required and cannot be empty`

### ❌ Test 2.4: drivers_license_number as "Other" (Should fail with 400)
```json
{
  "drivers_license_number": "Other",
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "days": 30,
  "consent": true
}
```
**Expected Error:** `drivers_license_number cannot be 'Other'. Please provide a valid value`

### ❌ Test 2.5: Missing company_id (Should fail with 400)
```json
{
  "drivers_license_number": "DL123456789",
  "permissible_purpose": "UNDERWRITING",
  "days": 30,
  "consent": true
}
```
**Expected Error:** `company_id is required and cannot be null or undefined`

### ❌ Test 2.6: Invalid permissible_purpose (Should fail with 400)
```json
{
  "drivers_license_number": "DL123456789",
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "INVALID_PURPOSE",
  "days": 30,
  "consent": true
}
```
**Expected Error:** `permissible_purpose must be one of: EMPLOYMENT, INSURANCE, LEGAL, GOVERNMENT, UNDERWRITING, FRAUD`

### ❌ Test 2.7: Missing days (Should fail with 400)
```json
{
  "drivers_license_number": "DL123456789",
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "consent": true
}
```
**Expected Error:** `days is required and cannot be null or undefined`

### ❌ Test 2.8: Negative days (Should fail with 400)
```json
{
  "drivers_license_number": "DL123456789",
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "days": -5,
  "consent": true
}
```
**Expected Error:** `Value must be a non-negative number`

### ❌ Test 2.9: Non-integer days (Should fail with 400)
```json
{
  "drivers_license_number": "DL123456789",
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "days": 30.5,
  "consent": true
}
```
**Expected Error:** `Value must be an integer`

### ❌ Test 2.10: Missing consent (Should fail with 400)
```json
{
  "drivers_license_number": "DL123456789",
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "days": 30
}
```
**Expected Error:** `consent is required and cannot be null or undefined`

### ❌ Test 2.11: consent is false (Should fail with 400)
```json
{
  "drivers_license_number": "DL123456789",
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "days": 30,
  "consent": false
}
```
**Expected Error:** `Consent is required and must be true`

### ❌ Test 2.12: consent is not boolean (Should fail with 400)
```json
{
  "drivers_license_number": "DL123456789",
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "days": 30,
  "consent": "yes"
}
```
**Expected Error:** `consent must be of type boolean, received string`

---

## 3. POST /batch-add-mvr Tests

### ✅ Test 3.1: Valid Request (Should succeed with 200)
```bash
curl -X POST <API_ENDPOINT>/batch-add-mvr \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_API_KEY>" \
  -d '{
    "company_id": "ACME_CORP_123",
    "permissible_purpose": "UNDERWRITING",
    "batch_mvrs": [
      {
        "drivers_license_number": "DL111111111",
        "full_legal_name": "Alice Smith",
        "birthdate": "1985-03-20",
        "weight": "140",
        "sex": "F",
        "height": "505",
        "hair_color": "Blonde",
        "eye_color": "Green",
        "issued_state_code": "NY",
        "state_code": "NY"
      },
      {
        "drivers_license_number": "DL222222222",
        "full_legal_name": "Bob Johnson",
        "birthdate": "1992-11-15",
        "weight": "190",
        "sex": "M",
        "height": "600",
        "hair_color": "Black",
        "eye_color": "Brown",
        "issued_state_code": "TX",
        "state_code": "TX"
      }
    ]
  }'
```

### ❌ Test 3.2: Missing company_id (Should fail with 400)
```json
{
  "permissible_purpose": "UNDERWRITING",
  "batch_mvrs": [
    { "..." }
  ]
}
```
**Expected Error:** `company_id is required and cannot be null or undefined`

### ❌ Test 3.3: Empty batch_mvrs array (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "batch_mvrs": []
}
```
**Expected Error:** `Value must be a non-empty array`

### ❌ Test 3.4: Missing batch_mvrs (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING"
}
```
**Expected Error:** `batch_mvrs is required and cannot be null or undefined`

### ❌ Test 3.5: Invalid permissible_purpose (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "Other",
  "batch_mvrs": [
    { "..." }
  ]
}
```
**Expected Error:** `permissible_purpose cannot be 'Other'. Please provide a valid value`

### ❌ Test 3.6: Invalid MVR in batch - missing required field (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "batch_mvrs": [
    {
      "drivers_license_number": "DL111111111",
      "full_legal_name": "Alice Smith",
      "birthdate": "1985-03-20",
      "weight": "140",
      "sex": "F",
      "height": "505",
      "hair_color": "Blonde",
      "eye_color": "Green",
      "issued_state_code": "NY",
      "state_code": "NY"
    },
    {
      "full_legal_name": "Bob Johnson",
      "birthdate": "1992-11-15",
      "weight": "190",
      "sex": "M",
      "height": "600",
      "hair_color": "Black",
      "eye_color": "Brown",
      "issued_state_code": "TX",
      "state_code": "TX"
    }
  ]
}
```
**Expected Error:** `Validation failed for MVR at index 1: drivers_license_number is required and cannot be null or undefined`

### ❌ Test 3.7: "Other" value in batch MVR (Should fail with 400)
```json
{
  "company_id": "ACME_CORP_123",
  "permissible_purpose": "UNDERWRITING",
  "batch_mvrs": [
    {
      "drivers_license_number": "DL111111111",
      "full_legal_name": "Other",
      "birthdate": "1985-03-20",
      "weight": "140",
      "sex": "F",
      "height": "505",
      "hair_color": "Blonde",
      "eye_color": "Green",
      "issued_state_code": "NY",
      "state_code": "NY"
    }
  ]
}
```
**Expected Error:** `Validation failed for MVR at index 0: full_legal_name cannot be 'Other'. Please provide a valid value`

---

## Testing Instructions

### Option 1: Using curl (for deployed API)
1. Replace `<API_ENDPOINT>` with your actual API Gateway URL
2. Replace `<YOUR_API_KEY>` with your API key
3. Run the curl commands directly

### Option 2: Using SAM local testing
```bash
# Start the API locally
sam local start-api

# Then use curl with localhost
curl -X POST http://localhost:3000/add-mvr \
  -H "Content-Type: application/json" \
  -d '{ "test_payload_here" }'
```

### Option 3: Using Postman or Insomnia
1. Import the test cases as a collection
2. Set up environment variables for API_ENDPOINT and API_KEY
3. Run through each test case

---

## Expected Results Summary

| Test Case | Expected Status | Expected Behavior |
|-----------|----------------|-------------------|
| Valid requests | 200/201 | Request succeeds |
| Missing required fields | 400 | Clear error message |
| Empty string values | 400 | "cannot be empty" error |
| "Other" values | 400 | "cannot be 'Other'" error |
| Invalid types | 400 | Type mismatch error |
| False consent/authorization | 400 | "must be true" error |
| Negative numbers | 400 | "must be non-negative" error |
| Invalid permissible_purpose | 400 | List of valid values |

---

## Quick Test Script

Save this as `test_validation.sh`:

```bash
#!/bin/bash

API_ENDPOINT="<YOUR_API_ENDPOINT>"
API_KEY="<YOUR_API_KEY>"

echo "Testing validation errors..."

# Test missing company_id
echo -e "\n=== Test: Missing company_id ==="
curl -X POST "$API_ENDPOINT/add-mvr" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"permissible_purpose":"UNDERWRITING","price_paid":25.50,"redisclosure_authorization":true,"mvr":{"drivers_license_number":"DL123","full_legal_name":"Test","birthdate":"1990-01-01","weight":"180","sex":"M","height":"510","hair_color":"Brown","eye_color":"Blue","issued_state_code":"CA","state_code":"CA"}}'

# Test "Other" value
echo -e "\n\n=== Test: 'Other' in company_id ==="
curl -X POST "$API_ENDPOINT/add-mvr" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"company_id":"Other","permissible_purpose":"UNDERWRITING","price_paid":25.50,"redisclosure_authorization":true,"mvr":{"drivers_license_number":"DL123","full_legal_name":"Test","birthdate":"1990-01-01","weight":"180","sex":"M","height":"510","hair_color":"Brown","eye_color":"Blue","issued_state_code":"CA","state_code":"CA"}}'

# Test false authorization
echo -e "\n\n=== Test: redisclosure_authorization false ==="
curl -X POST "$API_ENDPOINT/add-mvr" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"company_id":"TEST123","permissible_purpose":"UNDERWRITING","price_paid":25.50,"redisclosure_authorization":false,"mvr":{"drivers_license_number":"DL123","full_legal_name":"Test","birthdate":"1990-01-01","weight":"180","sex":"M","height":"510","hair_color":"Brown","eye_color":"Blue","issued_state_code":"CA","state_code":"CA"}}'

# Test missing consent
echo -e "\n\n=== Test: Missing consent in GET ==="
curl -X GET "$API_ENDPOINT/get-mvr" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"drivers_license_number":"DL123","company_id":"TEST123","permissible_purpose":"UNDERWRITING","days":30}'

echo -e "\n\nTests complete!"
```

Make it executable:
```bash
chmod +x test_validation.sh
./test_validation.sh
```
