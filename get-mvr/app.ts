/* eslint-disable prettier/prettier */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetSecretValueCommand, SecretsManagerClient, } from "@aws-sdk/client-secrets-manager";
import { Pool, PoolClient } from "pg";
import {
  FirehoseClient,
  PutRecordCommand
} from "@aws-sdk/client-firehose";
import {
  validateOrThrow,
  schemas,
  HttpError
} from './validation';

const firehose = new FirehoseClient({ region: process.env.AWS_REGION || "us-east-1" });
const DELIVERY_STREAM = process.env.AUDIT_FIREHOSE_NAME || "CompanyAuditStream";
let globalPool: Pool | null = null;


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

interface DatabaseConfigVariables {
  MVR_DB_HOST?: string;
  MVR_DB_NAME?: string;
  MVR_DB_PORT?: string;
  AWS_REGION?: string;
  MVR_DB_USERNAME?: string;
  MVR_DB_PASSWORD?: string;
}

interface MVRViolation {
  violation_date: string;
  conviction_date?: string;
  location?: string;
  points_assessed?: number;
  violation_code?: string;
  description?: string;
}

interface MVRWithdrawal {
  effective_date: string;
  eligibility_date?: string;
  action_type?: string;
  reason?: string;
}

interface MVRAccident {
  accident_date: string;
  location?: string;
  acd_code?: string;
  description?: string;
}

interface MVRCrime {
  crime_date: string;
  conviction_date?: string;
  offense_code?: string;
  description?: string;
}

interface MVRLicenseInfo {
  license_class?: string;
  issue_date?: string;
  expiration_date?: string;
  status?: string;
  restrictions?: string;
}

interface MVRTransaction {
  seller_id: string;
  buyer_id: string;
  state_code: string;
}

interface CompleteMVRRecord {
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
  date_uploaded?: Date;
  licenseInfo: MVRLicenseInfo | null;
  violations: MVRViolation[];
  withdrawals: MVRWithdrawal[];
  accidents: MVRAccident[];
  crimes: MVRCrime[];
  transaction: MVRTransaction | null;
}

const getSecretValue = async (
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

const createDatabasePool = async (): Promise<Pool> => {
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
    console.error("Failed to create database pool:", error);
    throw error;
  }
};

async function sendAuditLog(
  userData: User,
  mvrRecord: CompleteMVRRecord,
  company_id: string,
  stored_company_id: string,
  operation = "GET_MVR"
): Promise<void> {
  console.log(`Sending audit log to Firehose: ${DELIVERY_STREAM}`);

  const now = new Date();
  const payload = {

    timestamp: now.toISOString(),
    operation: operation,
    company_partition: company_id,
    company_id: company_id,
    function_name: 'get-mvr-lambda',
    success: true,
    affected_records_count: 1,
    operation_category: 'READ' as const,
    action: operation,
    year: now.getFullYear().toString(),
    month: (now.getMonth() + 1).toString().padStart(2, '0'),
    day: now.getDate().toString().padStart(2, '0'),


    accessor: {
      company_id: company_id,
      access_timestamp: now.toISOString()
    },


    drivers_license_number: userData.drivers_license_number,
    mvr_id: userData.current_mvr_id,
    user_id: userData.id,
    full_legal_name: userData.full_legal_name,
    issued_state_code: userData.issued_state_code,


    seller: mvrRecord.transaction ? {
      seller_id: mvrRecord.transaction.seller_id,
      buyer_id: mvrRecord.transaction.buyer_id,
      transaction_state: mvrRecord.transaction.state_code,
      company_id: stored_company_id
    } : {
      company_id: stored_company_id
    },

    mvr_data: mvrRecord
  };

  console.log(`Audit payload:`, JSON.stringify(payload, null, 2));

  try {
    const command = new PutRecordCommand({
      DeliveryStreamName: DELIVERY_STREAM,
      Record: {
        Data: Buffer.from(JSON.stringify(payload) + "\n", 'utf-8')
      }
    });

    const response = await firehose.send(command);
    console.log(`Firehose response:`, JSON.stringify(response, null, 2));
  } catch (error) {
    console.error(`Firehose error:`, error);
  }
}

async function sendFailureAuditLog(driversLicense: string, company_id: string, error: Error, operation = "GET_MVR_FAILED"): Promise<void> {
  console.log(`Sending failure audit log to Firehose: ${DELIVERY_STREAM}`);

  const now = new Date();
  const failurePayload = {
    drivers_license_number: driversLicense,
    company_id: company_id,
    timestamp: now.toISOString(),
    operation: operation,
    function_name: 'get-mvr-lambda',
    success: false,
    error_message: error.message,
    operation_category: 'READ' as const,


    action: operation,
    year: now.getFullYear().toString(),
    month: (now.getMonth() + 1).toString().padStart(2, '0'),
    day: now.getDate().toString().padStart(2, '0')
  };

  try {
    const command = new PutRecordCommand({
      DeliveryStreamName: DELIVERY_STREAM,
      Record: {
        Data: Buffer.from(JSON.stringify(failurePayload) + "\n", 'utf-8')
      }
    });

    await firehose.send(command);
    console.log("Failure audit log sent successfully");
  } catch (auditError) {
    console.error("Failed to send failure audit log:", auditError);
  }
}

export const lambdaHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  let drivers_license_number: string;
  let company_id: string;
  let permissible_purpose: string;
  let days: number;
  let consent: boolean;

  try {
    if (!event.body) {
      throw new HttpError("Missing request body", 400);
    }

    const body = JSON.parse(event.body);

    validateOrThrow(body, schemas.getMvr, 400);

    drivers_license_number = body.drivers_license_number;
    company_id = body.company_id;
    permissible_purpose = body.permissible_purpose;
    days = body.days;
    consent = body.consent;

  } catch (error: unknown) {
    console.error("Input validation error:", error);
    const err = ensureError(error);
    const statusCode = err instanceof HttpError ? err.statusCode : 400;

    return {
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: err.message || "Error validating request parameters",
      }),
    };
  }

  let client: PoolClient;
  
  try {
    const pool: Pool = await createDatabasePool();
    client = await pool.connect();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const userCheckQuery = `
      SELECT 
        id,
        drivers_license_number,
        full_legal_name,
        birthdate,
        weight,
        sex,
        height,
        hair_color,
        eye_color,
        medical_information,
        address,
        city,
        issued_state_code,
        zip,
        phone_number,
        email,
        current_mvr_id
      FROM users 
      WHERE drivers_license_number = $1
    `;
    
    const userResult = await client.query(userCheckQuery, [drivers_license_number]);
    
    if (userResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "No user found with this driver's license number",
        }),
      };
    }
    
    let userData = userResult.rows[0];
    
    if (!userData.current_mvr_id) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "User found but no MVR ID associated",
        }),
      };
    }
    
    const mvrDateCheckQuery = `
      SELECT id, report_date, order_date
      FROM mvr_records 
      WHERE id = $1 
        AND (report_date >= $2 OR order_date >= $2)
    `;
    
    const mvrDateResult = await client.query(mvrDateCheckQuery, [userData.current_mvr_id, cutoffDate]);
    
    if (mvrDateResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `No MVR found within the last ${days} days`,
        }),
      };
    }
    
    const optimizedQuery = `
      SELECT
        u.id,
        u.drivers_license_number,
        u.full_legal_name,
        u.birthdate,
        u.weight,
        u.sex,
        u.height,
        u.hair_color,
        u.eye_color,
        u.medical_information,
        u.address,
        u.city,
        u.issued_state_code,
        u.zip,
        u.phone_number,
        u.email,
        u.current_mvr_id,
        -- MVR Record data
        mvr.claim_number,
        mvr.order_id,
        mvr.order_date,
        mvr.report_date,
        mvr.reference_number,
        mvr.system_use,
        mvr.mvr_type,
        mvr.state_code,
        mvr.purpose,
        mvr.time_frame,
        mvr.is_certified,
        mvr.total_points,
        mvr.consent,
        mvr.price_paid,
        mvr.redisclosure_authorization,
        mvr.storage_limitations,
        mvr.company_id,
        -- License Info
        dli.license_class,
        dli.issue_date,
        dli.expiration_date,
        dli.status,
        dli.restrictions,
        -- Transaction Info
        t.seller_id,
        t.buyer_id,
        t.state_code as transaction_state
      FROM users u
      JOIN mvr_records mvr ON u.current_mvr_id = mvr.id
      LEFT JOIN drivers_license_info dli ON u.current_mvr_id = dli.mvr_id
      LEFT JOIN transactions t ON u.current_mvr_id = t.mvr_id
      WHERE u.drivers_license_number = $1
    `;

    const [mainResult, violationsResult, withdrawalsResult, accidentsResult, crimesResult] = await Promise.all([
      client.query(optimizedQuery, [drivers_license_number]),
      
      client.query(`
        SELECT 
          tv.violation_date,
          tv.conviction_date,
          tv.location,
          tv.points_assessed,
          tv.violation_code,
          tv.description
        FROM users u
        JOIN traffic_violations tv ON u.current_mvr_id = tv.mvr_id
        WHERE u.drivers_license_number = $1
        ORDER BY tv.violation_date DESC
      `, [drivers_license_number]),

      client.query(`
        SELECT 
          w.effective_date,
          w.eligibility_date,
          w.action_type,
          w.reason
        FROM users u
        JOIN withdrawals w ON u.current_mvr_id = w.mvr_id
        WHERE u.drivers_license_number = $1
        ORDER BY w.effective_date DESC
      `, [drivers_license_number]),

      client.query(`
        SELECT 
          ar.accident_date,
          ar.location,
          ar.acd_code,
          ar.description
        FROM users u
        JOIN accident_reports ar ON u.current_mvr_id = ar.mvr_id
        WHERE u.drivers_license_number = $1
        ORDER BY ar.accident_date DESC
      `, [drivers_license_number]),

      client.query(`
        SELECT 
          tc.crime_date,
          tc.conviction_date,
          tc.offense_code,
          tc.description
        FROM users u
        JOIN traffic_crimes tc ON u.current_mvr_id = tc.mvr_id
        WHERE u.drivers_license_number = $1
        ORDER BY tc.crime_date DESC
      `, [drivers_license_number])
    ]);

    userData = mainResult.rows[0];


    const stored_company_id = userData.company_id;

    const mvrRecord = {
      drivers_license_number: userData.drivers_license_number,
      full_legal_name: userData.full_legal_name,
      birthdate: userData.birthdate,
      weight: userData.weight,
      sex: userData.sex,
      height: userData.height,
      hair_color: userData.hair_color,
      eye_color: userData.eye_color,
      medical_information: userData.medical_information,
      address: userData.address,
      city: userData.city,
      issued_state_code: userData.issued_state_code,
      zip: userData.zip,
      phone_number: userData.phone_number,
      email: userData.email,
      claim_number: userData.claim_number,
      order_id: userData.order_id,
      order_date: userData.order_date,
      report_date: userData.report_date,
      reference_number: userData.reference_number,
      system_use: userData.system_use,
      mvr_type: userData.mvr_type,
      state_code: userData.state_code,
      purpose: userData.purpose,
      time_frame: userData.time_frame,
      is_certified: userData.is_certified,
      total_points: userData.total_points,
      date_uploaded: userData.date_uploaded,
      consent: userData.consent,
      price_paid: userData.price_paid,
      redisclosure_authorization: userData.redisclosure_authorization,
      storage_limitations: userData.storage_limitations,
      licenseInfo: userData.license_class ? {
        license_class: userData.license_class,
        issue_date: userData.issue_date,
        expiration_date: userData.expiration_date,
        status: userData.status,
        restrictions: userData.restrictions,
      } : null,
      violations: violationsResult.rows,
      withdrawals: withdrawalsResult.rows,
      accidents: accidentsResult.rows,
      crimes: crimesResult.rows,
      transaction: userData.seller_id ? {
        seller_id: userData.seller_id,
        buyer_id: userData.buyer_id,
        state_code: userData.transaction_state,
      } : null,
    };

    const response = {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mvrRecord),
    };

    try {
      await sendAuditLog(userData, mvrRecord, company_id, stored_company_id, "GET_MVR");
      console.log("Audit log sent successfully");
    } catch (err) {
      console.error("Firehose log failed:", err);
    }

    return response;
    
  } catch (error: unknown) {
    console.error("Error retrieving MVR record:", error);
    const err = ensureError(error);

    if (company_id && drivers_license_number) {
      try {
        await sendFailureAuditLog(drivers_license_number, company_id, err);
        console.log("Failure audit log sent successfully");
      } catch (auditErr) {
        console.error("Failure audit log failed:", auditErr);
      }
    }

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: err.message || "Internal server error",
      }),
    };
  } finally {
    if (client!) {
      client.release();
    }
  }
};

function ensureError(value: unknown): Error {
  if (value instanceof Error) return value

  let stringified = '[Unable to stringify the thrown value]'
  try {
    stringified = JSON.stringify(value)
  } catch {}

  const error = new Error(`This value was thrown as is, not through an Error: ${stringified}`)
  return error
}