/* eslint-disable prettier/prettier */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Pool, PoolClient } from 'pg';
import { format, subDays } from 'date-fns';
import {
  FirehoseClient,
  PutRecordCommand
} from "@aws-sdk/client-firehose";

const firehose = new FirehoseClient({ region: process.env.AWS_REGION || "us-east-1" });
const DELIVERY_STREAM = process.env.AUDIT_FIREHOSE_NAME || "MVRAuditFirehose";
let globalPool: Pool | null = null;

// TODO: 
// Delete the MVR record and the corresponding data when a new one is put in place to replace it

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

const THIRTY_DAYS = 30;

export const getSecretValue = async (secretName: string): Promise<DatabaseConfigVariables> => {
  if (!secretName) {
    throw new Error("Secret name is required");
  }

  try {
    const client = new SecretsManagerClient();
    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: secretName,
      })
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
  if (globalPool) {
    return globalPool;
  }

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
    
    globalPool = new Pool(poolConfig);
    
    
    return globalPool;
  } catch (error) {
    console.error('Failed to create database pool:', error);
    throw error;
  }
};


async function logSelectOperation(client: PoolClient, tableName: string, payload?: any): Promise<void> {
  try {
    await client.query(
      'SELECT audit_select_function($1, $2)',
      [tableName, payload ? JSON.stringify(payload) : null]
    );
  } catch (error) {
    console.error('Error logging SELECT operation:', error);
  }
}

async function checkExistingUser(client: PoolClient, driversLicense: string): Promise<{ userId: number | null, currentMvrId: number | null, hasRecentMvr: boolean }> {
  const userQuery = `
    SELECT id, current_mvr_id 
    FROM users 
    WHERE drivers_license_number = $1
  `;
  
  const userResult = await client.query(userQuery, [driversLicense]);
  
  await logSelectOperation(client, 'users', { drivers_license_number: driversLicense, query_type: 'check_existing_user' });
  
  if (userResult.rows.length === 0) {
    return { userId: null, currentMvrId: null, hasRecentMvr: false };
  }
  
  const userId = userResult.rows[0].id;
  const currentMvrId = userResult.rows[0].current_mvr_id;
  
  if (!currentMvrId) {
    return { userId, currentMvrId, hasRecentMvr: false };
  }
  
  const thirtyDaysAgo = format(subDays(new Date(), THIRTY_DAYS), 'yyyy-MM-dd');
  
  const mvrQuery = `
    SELECT id 
    FROM mvr_records 
    WHERE id = $1 AND date_uploaded >= $2
  `;
  
  const mvrResult = await client.query(mvrQuery, [currentMvrId, thirtyDaysAgo]);
  
  await logSelectOperation(client, 'mvr_records', { mvr_id: currentMvrId, query_type: 'check_recent_mvr' });
  
  const hasRecentMvr = mvrResult.rows.length > 0;
  
  return { userId, currentMvrId, hasRecentMvr };
}

async function createMvrRecord(client: PoolClient, mvrData: MVRData): Promise<number> {
  const query = `
    INSERT INTO mvr_records (
      claim_number, order_id, order_date, report_date, 
      reference_number, system_use, mvr_type, state_code, 
      purpose, time_frame, is_certified, total_points, date_uploaded
    ) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
    RETURNING id
  `;
  
  const params = [
    mvrData.claim_number || null,
    mvrData.order_id || null,
    mvrData.order_date ? mvrData.order_date : format(new Date(), 'yyyy-MM-dd'),
    mvrData.report_date || format(new Date(), 'yyyy-MM-dd'),
    mvrData.reference_number || null,
    mvrData.system_use || null,
    mvrData.mvr_type || null,
    mvrData.state_code,
    mvrData.purpose || null,
    mvrData.time_frame || null,
    mvrData.is_certified || false,
    mvrData.total_points || 0
  ];
  
  const result = await client.query(query, params);
  return result.rows[0].id;
}

async function createUser(client: PoolClient, mvrData: MVRData, mvrId: number): Promise<number> {
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
    mvrData.email || null
  ];
  
  const result = await client.query(query, params);
  return result.rows[0].id;
}

async function updateUserMvrId(client: PoolClient, userId: number, mvrId: number): Promise<void> {
  const query = `
    UPDATE users 
    SET current_mvr_id = $1 
    WHERE id = $2
  `;
  
  await client.query(query, [mvrId, userId]);
}

async function addDriverLicenseInfo(client: PoolClient, mvrData: MVRData, mvrId: number): Promise<void> {
  if (!mvrData.license_class && !mvrData.issue_date && !mvrData.expiration_date) {
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
    mvrData.restrictions || null
  ];
  
  await client.query(query, params);
}

async function addTrafficViolations(client: PoolClient, violations: MVRViolation[], mvrId: number): Promise<void> {
  if (!violations || violations.length === 0) {
    return;
  }
  
  for (const violation of violations) {
    const query = `
      INSERT INTO traffic_violations (
        mvr_id, violation_date, conviction_date, location, 
        points_assessed, violation_code, description
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    
    const params = [
      mvrId,
      violation.violation_date,
      violation.conviction_date || null,
      violation.location || null,
      violation.points_assessed || 0,
      violation.violation_code || null,
      violation.description || null
    ];
    
    await client.query(query, params);
  }
}

async function addWithdrawals(client: PoolClient, withdrawals: MVRWithdrawal[], mvrId: number): Promise<void> {
  if (!withdrawals || withdrawals.length === 0) {
    return;
  }
  
  for (const withdrawal of withdrawals) {
    const query = `
      INSERT INTO withdrawals (
        mvr_id, effective_date, eligibility_date, action_type, reason
      ) 
      VALUES ($1, $2, $3, $4, $5)
    `;
    
    const params = [
      mvrId,
      withdrawal.effective_date,
      withdrawal.eligibility_date || null,
      withdrawal.action_type || null,
      withdrawal.reason || null
    ];
    
    await client.query(query, params);
  }
}

async function addAccidents(client: PoolClient, accidents: MVRAccident[], mvrId: number): Promise<void> {
  if (!accidents || accidents.length === 0) {
    return;
  }
  
  for (const accident of accidents) {
    const query = `
      INSERT INTO accident_reports (
        mvr_id, accident_date, location, acd_code, description
      ) 
      VALUES ($1, $2, $3, $4, $5)
    `;
    
    const params = [
      mvrId,
      accident.accident_date,
      accident.location || null,
      accident.acd_code || null,
      accident.description || null
    ];
    
    await client.query(query, params);
  }
}

async function addTrafficCrimes(client: PoolClient, crimes: MVRCrime[], mvrId: number): Promise<void> {
  if (!crimes || crimes.length === 0) {
    return;
  }
  
  for (const crime of crimes) {
    const query = `
      INSERT INTO traffic_crimes (
        mvr_id, crime_date, conviction_date, offense_code, description
      ) 
      VALUES ($1, $2, $3, $4, $5)
    `;
    
    const params = [
      mvrId,
      crime.crime_date,
      crime.conviction_date || null,
      crime.offense_code || null,
      crime.description || null
    ];
    
    await client.query(query, params);
  }
}

async function getUserData(client: PoolClient, userId: number): Promise<User> {
  const query = `
    SELECT id, drivers_license_number, full_legal_name, birthdate, 
           weight, sex, height, hair_color, eye_color, medical_information,
           address, city, issued_state_code, zip, phone_number, email, current_mvr_id
    FROM users 
    WHERE id = $1
  `;
  
  const result = await client.query(query, [userId]);
  
  await logSelectOperation(client, 'users', { user_id: userId, query_type: 'get_user_data' });
  
  if (result.rows.length === 0) {
    throw new Error(`User with id ${userId} not found`);
  }
  
  return result.rows[0];
}

async function sendAuditLog(userData: User, company_id: string, mvrData: MVRData, operation = "ADD_MVR"): Promise<void> {
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
    function_name: 'add-mvr-lambda',
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

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  let mvrData: MVRData;
  let company_id: string | undefined;
  let permissible_purpose: string | undefined;
  let price_paid: number | undefined;
  let redisclosure_authorization: boolean | undefined;
  let storage_limitations: number | undefined;
  
  try {
    if (!event.body) {
      throw new Error('Missing request body');
    }
    const body = JSON.parse(event.body);
    mvrData = body.mvr;
    mvrData.date_uploaded = new Date();
    company_id = body.company_id;
    permissible_purpose = body.permissible_purpose;
    
    if (!mvrData.drivers_license_number) {
      throw new Error('Required fields missing');
    }

    if(redisclosure_authorization == false || redisclosure_authorization === undefined) {
      throw new HttpError('Redisclosure authorization is required', 403);
    }

    if(price_paid === undefined || price_paid < 0) {
      throw new HttpError('Price paid is required and must be non-negative', 400);
    }

    if(storage_limitations === undefined || storage_limitations < 0) {
      storage_limitations = 5 * 365; 
    }

    
    if (!company_id) {
      throw new Error('Company ID is required');
    }
    if (!checkPermissiblePurpose(permissible_purpose || '')) {
      throw new Error('Invalid purpose for MVR request');
    }
  } catch (error: unknown) {
    const err = ensureError(error);
    const statusCode = err instanceof HttpError ? err.statusCode : 400;
  
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Invalid request data' })
    };
  }
  
  const pool: Pool = await createDatabasePool();
  const client: PoolClient = await pool.connect();
  
  try {
    await client.query('BEGIN');
  
    const { userId, hasRecentMvr } = await checkExistingUser(client, mvrData.drivers_license_number);

    if (userId && hasRecentMvr) {
      await client.query('COMMIT');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'MVR uploaded less than 30 days ago' })
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

    await addDriverLicenseInfo(client, mvrData, mvrId);
    await addTrafficViolations(client, mvrData.violations || [], mvrId);
    await addWithdrawals(client, mvrData.withdrawals || [], mvrId);
    await addAccidents(client, mvrData.accidents || [], mvrId);
    await addTrafficCrimes(client, mvrData.crimes || [], mvrId);
    
    await client.query('COMMIT');

    const userData = await getUserData(client, finalUserId);
    
    try {
      await sendAuditLog(userData, company_id, mvrData, userId ? "UPDATE_MVR" : "CREATE_MVR");
      console.log("Audit log sent successfully");
    } catch (auditError) {
      console.error("Audit log failed:", auditError);
    }
    
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: userId ? 'User MVR updated successfully' : 'New user and MVR created successfully',
        mvr_id: mvrId,
        user_id: finalUserId
      })
    };
    
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    console.error('Error processing MVR:', error);
    
    try {
      const failurePayload = {
        drivers_license_number: mvrData.drivers_license_number,
        company_id: company_id,
        timestamp: new Date().toISOString(),
        operation: "CREATE_MVR_FAILED",
        function_name: 'add-mvr-lambda',
        success: false,
        error_message: error instanceof Error ? error.message : 'Unknown error',
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
    
    const err = ensureError(error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Internal server error' })
    };
    
  } finally {
    client.release();
  }
};

// 'EMPLOYMENT', 
// 'INSURANCE', 
// 'LEGAL', 
// 'GOVERNMENT',
function checkPermissiblePurpose(purpose: string): boolean {
  const permissiblePurposes = [
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

class HttpError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'HttpError';
  }
}