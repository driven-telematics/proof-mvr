/* eslint-disable prettier/prettier */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { Pool, PoolClient } from "pg";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  FirehoseClient,
  PutRecordCommand
} from "@aws-sdk/client-firehose";
import { format, subDays } from "date-fns";

const firehose = new FirehoseClient({ region: process.env.AWS_REGION || "us‑east‑1" });
const DELIVERY_STREAM = process.env.AUDIT_FIREHOSE_NAME || "MVRAuditFirehose";




interface DatabaseConfigVariables {
  MVR_DB_HOST?: string;
  MVR_DB_NAME?: string;
  MVR_DB_PORT?: string;
  AWS_REGION?: string;
  MVR_DB_USERNAME?: string;
  MVR_DB_PASSWORD?: string;
}

interface User {
  id: string;
  drivers_license_number: string;
  full_legal_name: string;
  birthdate: Date;
  weight: string;
  sex: string;
  height: string;
  hair_color: string;
  eye_color: string;
  medical_information: string;
  address: string;
  city: string;
  issued_state_code: string;
  zip: number;
  phone_number: number;
  email: string;
  current_mvr_id: number;
}

export interface MVRViolation {
  violation_date: string;
  conviction_date?: string;
  location?: string;
  points_assessed?: number;
  violation_code?: string;
  description?: string;
}

export interface MVRWithdrawal {
  effective_date: string;
  eligibility_date?: string;
  action_type?: string;
  reason?: string;
}

export interface MVRAccident {
  accident_date: string;
  location?: string;
  acd_code?: string;
  description?: string;
}

export interface MVRCrime {
  crime_date: string;
  conviction_date?: string;
  offense_code?: string;
  description?: string;
}

export interface MVRData {
  drivers_license_number: string;
  full_legal_name: string;
  birthdate: string;
  weight: string;
  sex: string;
  height: string;
  hair_color: string;
  eye_color: string;
  medical_information?: string;
  address?: string;
  city?: string;
  issued_state_code: string;
  zip?: number;
  phone_number?: number;
  email?: string;

  claim_number?: string;
  order_id?: string;
  order_date?: string;
  report_date?: string;
  reference_number?: string;
  system_use?: string;
  mvr_type?: string;
  state_code: string;
  purpose?: string;
  time_frame?: string;
  is_certified?: boolean;
  total_points?: number;

  license_class?: string;
  issue_date?: string;
  expiration_date?: string;
  status?: string;
  restrictions?: string;
  date_uploaded?: Date;

  violations?: MVRViolation[];
  withdrawals?: MVRWithdrawal[];
  accidents?: MVRAccident[];
  crimes?: MVRCrime[];
}

interface BatchProcessResult {
  success: boolean;
  message: string;
  mvr_id?: number;
  user_id?: number;
  error?: string;
  drivers_license_number: string;
}


export const getSecretValue = async (
  secretName: string,
): Promise<DatabaseConfigVariables> => {
  if (!secretName) {
    throw new Error("Secret name is required");
  }

  try {
    const client = new SecretsManagerClient();
    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: secretName,
      }),
    );

    if (!response.SecretString) {
      throw new Error("Secret string is empty or undefined");
    }

    const secret = JSON.parse(response.SecretString);

    return secret;
  } catch (error) {
    console.error(`Failed to retrieve secret ${secretName}:`, error);
    throw error;
  }
};

export const createDatabasePool = async (): Promise<Pool> => {
  try {
    const secrets = await getSecretValue("mvr-global-environments");
    const poolConfig = {
      host: secrets.MVR_DB_HOST,
      database: secrets.MVR_DB_NAME,
      user: secrets.MVR_DB_USERNAME ,
      password: secrets.MVR_DB_PASSWORD,
      port: parseInt(secrets.MVR_DB_PORT || "5432"),
      ssl: {
        rejectUnauthorized: false,
      },
      max: 20, 
      idleTimeoutMillis: 30000, 
      connectionTimeoutMillis: 2000, 
      statement_timeout: 5000,
      query_timeout: 5000, 
    };
    const dbPool = new Pool(poolConfig);
    return dbPool;
  } catch (error) {
    console.error("Failed to create database pool:", error);
    throw error;
  }
};

async function getUserData(client: PoolClient, userId: number): Promise<User> {
  const query = `
    SELECT id, drivers_license_number, full_legal_name, birthdate, 
           weight, sex, height, hair_color, eye_color, medical_information,
           address, city, issued_state_code, zip, phone_number, email, current_mvr_id
    FROM users 
    WHERE id = $1
  `;
  
  const result = await client.query(query, [userId]);
  if (result.rows.length === 0) {
    throw new Error(`User with id ${userId} not found`);
  }
  
  return result.rows[0];
}

async function sendAuditLog(userData: User, company_id: string, mvrData: MVRData, operation = "BATCH_CREATE_MVR"): Promise<void> {
  console.log(`Attempting to send audit log to Firehose: ${DELIVERY_STREAM}`);
  
  const payload = {
    drivers_license_number: userData.drivers_license_number,
    mvr_id: userData.current_mvr_id,
    user_id: userData.id,
    full_legal_name: userData.full_legal_name,
    issued_state_code: userData.issued_state_code,
    
    order_id: mvrData.order_id,
    order_date: mvrData.order_date,
    report_date: mvrData.report_date,
    state_code: mvrData.state_code,
    mvr_type: mvrData.mvr_type,
    is_certified: mvrData.is_certified,
    total_points: mvrData.total_points,
    
    timestamp: new Date().toISOString(),
    operation: operation,
    company_partition: company_id,
    company_id: company_id,
    function_name: 'batch-add-mvr-lambda',
    success: true,
    affected_records_count: 1,
    operation_category: 'WRITE' as const
  };

  console.log(`Audit payload:`, JSON.stringify(payload, null, 2));

  try {
    const response = await firehose.send(
      new PutRecordCommand({
        DeliveryStreamName: DELIVERY_STREAM,
        Record: { Data: Buffer.from(JSON.stringify(payload) + "\n") }
      })
    );
    console.log(`Firehose response:`, response);
  } catch (error) {
    console.error(`Firehose error:`, error);
    throw error;
  }
}

async function sendBatchAuditLog(company_id: string, results: BatchProcessResult[], operation = "BATCH_PROCESS_COMPLETE"): Promise<void> {
  console.log(`Sending batch completion audit log to Firehose: ${DELIVERY_STREAM}`);
  
  const payload = {
    timestamp: new Date().toISOString(),
    operation: operation,
    company_id: company_id,
    function_name: 'batch-add-mvr-lambda',
    success: results.every(r => r.success),
    affected_records_count: results.filter(r => r.success).length,
    operation_category: 'WRITE' as const,
    batch_summary: {
      total_records: results.length,
      successful_records: results.filter(r => r.success).length,
      failed_records: results.filter(r => !r.success).length,
      new_users: results.filter(r => r.success && r.message.includes("New user")).length,
      updated_users: results.filter(r => r.success && r.message.includes("updated")).length,
      skipped_records: results.filter(r => r.success && r.message.includes("less than 30 days")).length
    }
  };

  try {
    const response = await firehose.send(
      new PutRecordCommand({
        DeliveryStreamName: DELIVERY_STREAM,
        Record: { Data: Buffer.from(JSON.stringify(payload) + "\n") }
      })
    );
    console.log(`Batch audit response:`, response);
  } catch (error) {
    console.error(`Batch audit error:`, error);
    throw error;
  }
}

async function checkExistingUser(
  client: PoolClient,
  driversLicense: string,
): Promise<{
  userId: number | null;
  currentMvrId: number | null;
  hasRecentMvr: boolean;
}> {
  const userQuery = `
    SELECT id, current_mvr_id 
    FROM users 
    WHERE drivers_license_number = $1
  `;

  const userResult = await client.query(userQuery, [driversLicense]);

  if (userResult.rows.length === 0) {
    return { userId: null, currentMvrId: null, hasRecentMvr: false };
  }

  const userId = userResult.rows[0].id;
  const currentMvrId = userResult.rows[0].current_mvr_id;

  if (!currentMvrId) {
    return { userId, currentMvrId, hasRecentMvr: false };
  }

  const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  const mvrQuery = `
    SELECT id 
    FROM mvr_records 
    WHERE id = $1 AND date_uploaded >= $2
  `;

  const mvrResult = await client.query(mvrQuery, [currentMvrId, thirtyDaysAgo]);
  const hasRecentMvr = mvrResult.rows.length > 0;

  return { userId, currentMvrId, hasRecentMvr };
}

async function createMvrRecord(
  client: PoolClient,
  mvrData: MVRData,
): Promise<number> {
  const query = `
    INSERT INTO mvr_records (
      claim_number, order_id, order_date, report_date, 
      reference_number, system_use, mvr_type, state_code, 
      purpose, time_frame, is_certified, total_points, date_uploaded
    ) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id
  `;

  const current_date = format(new Date(), "yyyy-MM-dd");

  const params = [
    mvrData.claim_number || null,
    mvrData.order_id || null,
    mvrData.order_date ? mvrData.order_date : current_date,
    mvrData.report_date || current_date,
    mvrData.reference_number || null,
    mvrData.system_use || null,
    mvrData.mvr_type || null,
    mvrData.state_code,
    mvrData.purpose || null,
    mvrData.time_frame || null,
    mvrData.is_certified || false,
    mvrData.total_points || 0,
    mvrData.date_uploaded ? mvrData.date_uploaded : new Date(),
  ];

  const result = await client.query(query, params);
  return result.rows[0].id;
}

async function createUser(
  client: PoolClient,
  mvrData: MVRData,
  mvrId: number,
): Promise<number> {
  const query = `
    INSERT INTO users (
      drivers_license_number, full_legal_name, birthdate, 
      weight, sex, height, hair_color, eye_color, 
      medical_information, current_mvr_id, address, city, 
      issued_state_code, zip, phone_number, email
    ) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING id
  `;

  const params = [
    mvrData.drivers_license_number,
    mvrData.full_legal_name,
    mvrData.birthdate,
    mvrData.weight,
    mvrData.sex,
    mvrData.height,
    mvrData.hair_color,
    mvrData.eye_color,
    mvrData.medical_information || null,
    mvrId,
    mvrData.address || null,
    mvrData.city || null,
    mvrData.issued_state_code,
    mvrData.zip || null,
    mvrData.phone_number || null,
    mvrData.email || null,
  ];

  const result = await client.query(query, params);
  return result.rows[0].id;
}

async function updateUserMvrId(
  client: PoolClient,
  userId: number,
  mvrId: number,
): Promise<void> {
  const query = `
    UPDATE users 
    SET current_mvr_id = $1 
    WHERE id = $2
  `;

  await client.query(query, [mvrId, userId]);
}

async function addDriverLicenseInfo(
  client: PoolClient,
  mvrData: MVRData,
  mvrId: number,
): Promise<void> {
  if (
    !mvrData.license_class &&
    !mvrData.issue_date &&
    !mvrData.expiration_date
  ) {
    return;
  }

  const query = `
    INSERT INTO drivers_license_info (
      mvr_id, license_class, issue_date, expiration_date, status, restrictions
    ) 
    VALUES ($1, $2, $3, $4, $5, $6)
  `;

  const params = [
    mvrId,
    mvrData.license_class || null,
    mvrData.issue_date || null,
    mvrData.expiration_date || null,
    mvrData.status || null,
    mvrData.restrictions || null,
  ];

  await client.query(query, params);
}

async function addWithdrawals(
  client: PoolClient,
  withdrawals: MVRWithdrawal[],
  mvrId: number,
): Promise<void> {
  if (!withdrawals || withdrawals.length === 0) {
    return;
  }

  const query = `
    INSERT INTO withdrawals (
      mvr_id, effective_date, eligibility_date, action_type, reason
    )
    VALUES ${withdrawals.map((_, i) => {
      const base = i * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    }).join(",\n")}
  `;

  const params = withdrawals.flatMap(w => [
    mvrId,
    w.effective_date,
    w.eligibility_date || null,
    w.action_type || null,
    w.reason || null,
  ]);

  await client.query(query, params);
}

async function addTrafficViolations(
  client: PoolClient,
  violations: MVRViolation[],
  mvrId: number,
): Promise<void> {
  if (!violations || violations.length === 0) return;

  const query = `
    INSERT INTO traffic_violations (
      mvr_id, violation_date, conviction_date, location, 
      points_assessed, violation_code, description
    )
    VALUES ${violations.map((_, i) => {
      const base = i * 7;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    }).join(",\n")}
  `;

  const params = violations.flatMap(v => [
    mvrId,
    v.violation_date,
    v.conviction_date || null,
    v.location || null,
    v.points_assessed || 0,
    v.violation_code || null,
    v.description || null,
  ]);

  await client.query(query, params);
}

async function addAccidents(
  client: PoolClient,
  accidents: MVRAccident[],
  mvrId: number,
): Promise<void> {
  if (!accidents || accidents.length === 0) return;

  const query = `
    INSERT INTO accident_reports (
      mvr_id, accident_date, location, acd_code, description
    )
    VALUES ${accidents.map((_, i) => {
      const base = i * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    }).join(",\n")}
  `;

  const params = accidents.flatMap(a => [
    mvrId,
    a.accident_date,
    a.location || null,
    a.acd_code || null,
    a.description || null,
  ]);

  await client.query(query, params);
}

async function addTrafficCrimes(
  client: PoolClient,
  crimes: MVRCrime[],
  mvrId: number,
): Promise<void> {
  if (!crimes || crimes.length === 0) return;

  const query = `
    INSERT INTO traffic_crimes (
      mvr_id, crime_date, conviction_date, offense_code, description
    )
    VALUES ${crimes.map((_, i) => {
      const base = i * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    }).join(",\n")}
  `;

  const params = crimes.flatMap(c => [
    mvrId,
    c.crime_date,
    c.conviction_date || null,
    c.offense_code || null,
    c.description || null,
  ]);

  await client.query(query, params);
}

async function processSingleMvr(
  client: PoolClient,
  mvrData: MVRData,
  company_id: string,
): Promise<BatchProcessResult> {
  try {
    if (!mvrData.drivers_license_number) {
      return {
        success: false,
        message: "Required fields missing",
        error: "Driver's license number is required",
        drivers_license_number: "unknown",
      };
    }

    const { userId, hasRecentMvr } = await checkExistingUser(
      client,
      mvrData.drivers_license_number,
    );

    if (userId && hasRecentMvr) {
      return {
        success: true,
        message: "MVR uploaded less than 30 days ago",
        drivers_license_number: mvrData.drivers_license_number,
        user_id: userId,
      };
    }

    const mvrId = await createMvrRecord(client, mvrData);

    let finalUserId: number;
    if (userId) {
      await updateUserMvrId(client, userId, mvrId);
      finalUserId = userId;
    } else {
      finalUserId = await createUser(client, mvrData, mvrId);
    }

    await Promise.all([
      addDriverLicenseInfo(client, mvrData, mvrId),
      addTrafficViolations(client, mvrData.violations || [], mvrId),
      addWithdrawals(client, mvrData.withdrawals || [], mvrId),
      addAccidents(client, mvrData.accidents || [], mvrId),
      addTrafficCrimes(client, mvrData.crimes || [], mvrId)
    ]);

    try {
      const userData = await getUserData(client, finalUserId);
      await sendAuditLog(userData, company_id, mvrData, userId ? "BATCH_UPDATE_MVR" : "BATCH_CREATE_MVR");
      console.log(`Audit log sent for user ${finalUserId}`);
    } catch (auditError) {
      console.error(`Audit log failed for user ${finalUserId}:`, auditError);
    }

    return {
      success: true,
      message: userId
        ? "User MVR updated successfully"
        : "New user and MVR created successfully",
      mvr_id: mvrId,
      user_id: finalUserId,
      drivers_license_number: mvrData.drivers_license_number,
    };
  } catch (error: unknown) {
    const err = ensureError(error);
    
    try {
      const failurePayload = {
        drivers_license_number: mvrData.drivers_license_number,
        company_id: company_id,
        timestamp: new Date().toISOString(),
        operation: "BATCH_CREATE_MVR_FAILED",
        function_name: 'batch-add-mvr-lambda',
        success: false,
        error_message: err.message,
        operation_category: 'WRITE' as const
      };
      
      await firehose.send(
        new PutRecordCommand({
          DeliveryStreamName: DELIVERY_STREAM,
          Record: { Data: Buffer.from(JSON.stringify(failurePayload) + "\n") }
        })
      );
    } catch (auditError) {
      console.error("Failed to send failure audit log:", auditError);
    }

    return {
      success: false,
      message: "Error processing MVR",
      error: err.message || "Unknown error",
      drivers_license_number: mvrData.drivers_license_number || "unknown",
    };
  }
}

export const lambdaHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  let company_id: string | undefined;
  let permissible_purpose: string | undefined;
  let mvrDataArray: MVRData[] = [];

  try {
    if (!event.body) {
      throw new Error("Missing request body");
    }

    const requestData = JSON.parse(event.body);
    
    company_id = requestData.company_id;
    mvrDataArray = requestData.batch_mvrs;
    permissible_purpose = requestData.permissible_purpose;

    if (!company_id) {
      throw new Error("Company ID is required");
    }

    if (!Array.isArray(mvrDataArray) || mvrDataArray.length === 0) {
      throw new Error("batch_mvrs must be a non-empty array");
    }

    if (!checkPermissiblePurpose(permissible_purpose || '')) {
      throw new Error('Invalid purpose for MVR request');
    }

  } catch (error: unknown) {
    console.error('Input validation error:', error);
    const err = ensureError(error);
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Invalid request data' })
    };
  }

  const pool: Pool = await createDatabasePool();
  const client: PoolClient = await pool.connect();
  const results: BatchProcessResult[] = [];

  try {
    await client.query("BEGIN");

    for (const mvrData of mvrDataArray) {
      const result = await processSingleMvr(client, mvrData, company_id!);
      results.push(result);
    }

    if (results.some((result) => !result.success)) {
      throw new Error("One or more MVR records failed to process");
    }

    await client.query("COMMIT");

    try {
      await sendBatchAuditLog(company_id!, results, "BATCH_PROCESS_COMPLETE");
      console.log("Batch completion audit log sent successfully");
    } catch (auditError) {
      console.error("Batch completion audit log failed:", auditError);
    }

    const totalRecords = results.length;
    const successCount = results.filter((r) => r.success).length;
    const newRecords = results.filter(
      (r) => r.success && r.message.includes("New user"),
    ).length;
    const updatedRecords = results.filter(
      (r) => r.success && r.message.includes("updated"),
    ).length;
    const skippedRecords = results.filter(
      (r) => r.success && r.message.includes("less than 30 days"),
    ).length;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Processed ${successCount}/${totalRecords} MVR records successfully`,
        summary: {
          total: totalRecords,
          successful: successCount,
          new_records: newRecords,
          updated_records: updatedRecords,
          skipped_records: skippedRecords,
        },
        results: results,
      }),
    };
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    console.error("Error processing MVR batch:", error);
    
    try {
      const failurePayload = {
        company_id: company_id,
        timestamp: new Date().toISOString(),
        operation: "BATCH_PROCESS_FAILED",
        function_name: 'batch-add-mvr-lambda',
        success: false,
        error_message: error instanceof Error ? error.message : 'Unknown error',
        affected_records_count: results.filter(r => r.success).length,
        operation_category: 'WRITE' as const,
        batch_summary: {
          total_records: results.length,
          successful_records: results.filter(r => r.success).length,
          failed_records: results.filter(r => !r.success).length
        }
      };
      
      await firehose.send(
        new PutRecordCommand({
          DeliveryStreamName: DELIVERY_STREAM,
          Record: { Data: Buffer.from(JSON.stringify(failurePayload) + "\n") }
        })
      );
    } catch (auditError) {
      console.error("Failed to send batch failure audit log:", auditError);
    }

    const err = ensureError(error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: err.message || "Internal server error",
        results: results,
      }),
    };
  } finally {
    client.release();
  }
};

function checkPermissiblePurpose(purpose: string): boolean {
  const permissiblePurposes = [
    'EMPLOYMENT', 
    'INSURANCE', 
    'LEGAL', 
    'GOVERNMENT',
    'UNDERWRITING',
    'FRAUD'
  ];
  return permissiblePurposes.includes(purpose);
}

function ensureError(value: unknown): Error {
  if (value instanceof Error) return value

  let stringified = '[Unable to stringify the thrown value]'
  try {
    stringified = JSON.stringify(value)
  } catch {}

  const error = new Error(`This value was thrown as is, not through an Error: ${stringified}`)
  return error
}