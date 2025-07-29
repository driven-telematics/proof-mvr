/* eslint-disable prettier/prettier */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetSecretValueCommand, SecretsManagerClient, } from "@aws-sdk/client-secrets-manager";
import { Pool, PoolClient } from "pg";
import {
  FirehoseClient,
  PutRecordCommand
} from "@aws-sdk/client-firehose";

const firehose = new FirehoseClient({ region: process.env.AWS_REGION || "us-east-1" });
const DELIVERY_STREAM = process.env.AUDIT_FIREHOSE_NAME || "MVRAuditFirehose";
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

async function sendAuditLog(userData: User, company_id: string): Promise<void> {
  const payload = {
    drivers_license_number: userData.drivers_license_number,
    mvr_id: userData.current_mvr_id,
    user_id: userData.id,
    timestamp: new Date().toISOString(),
    operation: "GET_MVR",           
    issued_state_code: userData.issued_state_code,
    full_legal_name: userData.full_legal_name,
    company_partition: company_id,
    company_id: company_id,
  };

  await firehose.send(
    new PutRecordCommand({
      DeliveryStreamName: DELIVERY_STREAM,
      Record: { Data: Buffer.from(JSON.stringify(payload) + "\n") }
    })
  );

}

export const lambdaHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  let drivers_license_number: string;
  let company_id: string;
  let permissible_purpose: string;

  try {
    if (!event.body) throw new Error("Missing request body");
    const body = JSON.parse(event.body);
    drivers_license_number = body.drivers_license_number;
    company_id = body.company_id;
    permissible_purpose = body.permissible_purpose;
    if (!drivers_license_number) throw new Error("Missing Drivers License");
    if (!checkPermissiblePurpose(permissible_purpose || '')) {
      throw new Error('Invalid purpose for MVR request');
    }
  } catch (error: unknown) {
    console.error("Input validation error:", error);
    const err = ensureError(error);
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: err.message || "Error Reading Drivers License",
      }),
    };
  }

  let client: PoolClient;
  
  try {
    const pool: Pool = await createDatabasePool();
    client = await pool.connect();
    
    const optimizedQuery = `
      WITH user_data AS (
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
          u.current_mvr_id
        FROM users u
        WHERE u.drivers_license_number = $1
      )
      SELECT 
        ud.*,
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
      FROM user_data ud
      LEFT JOIN mvr_records mvr ON ud.current_mvr_id = mvr.id
      LEFT JOIN drivers_license_info dli ON ud.current_mvr_id = dli.mvr_id
      LEFT JOIN transactions t ON ud.current_mvr_id = t.mvr_id
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

    if (mainResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "No user found with this driver's license number",
        }),
      };
    }

    const userData = mainResult.rows[0];
    
    if (!userData.current_mvr_id) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "User found but no MVR ID associated",
        }),
      };
    }

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

    setImmediate(() => {
      sendAuditLog(userData, company_id).catch(err => console.error("Firehose log failed:", err));
    });

    return response;
    
  } catch (error: unknown) {
    console.error("Error retrieving MVR record:", error);
    const err = ensureError(error);
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
