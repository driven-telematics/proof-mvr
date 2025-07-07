/* eslint-disable prettier/prettier */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { Pool, PoolClient } from "pg";
import { FirehoseClient, PutRecordCommand } from "@aws-sdk/client-firehose";

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
  username?: string;
  password?: string;
  MVR_DB_HOST?: string;
  MVR_DB_NAME?: string;
  MVR_DB_PORT?: string;
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
    const usernameAndPasswordSecret = await getSecretValue(
      "mvr-postgresql-username-and-password",
    );
    const otherValuesSecret = await getSecretValue("mvr-global-environments");
    const poolConfig = {
      host: otherValuesSecret.MVR_DB_HOST,
      database: otherValuesSecret.MVR_DB_NAME,
      user: usernameAndPasswordSecret.username,
      password: usernameAndPasswordSecret.password,
      port: parseInt(otherValuesSecret.MVR_DB_PORT || "5432"),
      ssl: {
        rejectUnauthorized: false,
      },
    };
    const dbPool = new Pool(poolConfig);
    return dbPool;
  } catch (error) {
    console.error("Failed to create database pool:", error);
    throw error;
  }
};

const firehose = new FirehoseClient({
  region: process.env.AWS_REGION || "us-east-1",
});

async function logToFirehose(data: User) {
  const deliveryStreamName = process.env.AUDIT_FIREHOSE_NAME;
  if (!deliveryStreamName) {
    console.log("AUDIT_FIREHOSE_NAME is not set; skipping Firehose logging.");
    return;
  }

  const record = {
    event: "GetMVR",
    timestamp: new Date().toISOString(),
    drivers_license_number: data.drivers_license_number,
    issued_state_code: data.issued_state_code,
    full_legal_name: data.full_legal_name,
    success: true,
  };

  try {
    await firehose.send(
      new PutRecordCommand({
        DeliveryStreamName: deliveryStreamName,
        Record: { Data: Buffer.from(JSON.stringify(record) + "\n") },
      }),
    );
  } catch (err) {
    console.error("Failed to log to Firehose:", err);
  }
}

export const lambdaHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  let drivers_license_number: string;

  try {
    if (!event.body) throw new Error("Missing request body");
    const body = JSON.parse(event.body);
    drivers_license_number = body.drivers_license_number;
    if (!drivers_license_number) throw new Error("Missing Drivers License");
  } catch (error: any) {
    console.error("Input validation error:", error);
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: error.message || "Error Reading Drivers License",
      }),
    };
  }

  try {
    const pool: Pool = await createDatabasePool();
    const client: PoolClient = await pool.connect();
    try {
      const userQuery = `
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
      const userResult = await client.query(userQuery, [
        drivers_license_number,
      ]);

      if (userResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "No user found with this driver's license number",
          }),
        };
      }

      const user = userResult.rows[0];
      const mvrId = user.current_mvr_id;

      if (!mvrId) {
        return {
          statusCode: 404,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "User found but no MVR ID associated",
          }),
        };
      }

      const mvrQuery = `
      SELECT 
        id,
        claim_number,
        order_id,
        order_date,
        report_date,
        reference_number,
        system_use,
        mvr_type,
        state_code,
        purpose,
        time_frame,
        is_certified,
        total_points
      FROM mvr_records
      WHERE id = $1
    `;
      const mvrResult = await client.query(mvrQuery, [mvrId]);

      if (mvrResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "MVR record not found" }),
        };
      }

      const mvr = mvrResult.rows[0];

      const licenseQuery = `
      SELECT 
        license_class,
        issue_date,
        expiration_date,
        status,
        restrictions
      FROM drivers_license_info
      WHERE mvr_id = $1
    `;
      const licenseResult = await client.query(licenseQuery, [mvrId]);
      const licenseInfo = licenseResult.rows[0] || null;

      const violationsQuery = `
      SELECT 
        violation_date,
        conviction_date,
        location,
        points_assessed,
        violation_code,
        description
      FROM traffic_violations
      WHERE mvr_id = $1
      ORDER BY violation_date DESC
    `;
      const violationsResult = await client.query(violationsQuery, [mvrId]);
      const violations = violationsResult.rows;

      const withdrawalsQuery = `
      SELECT 
        effective_date,
        eligibility_date,
        action_type,
        reason
      FROM withdrawals
      WHERE mvr_id = $1
      ORDER BY effective_date DESC
    `;
      const withdrawalsResult = await client.query(withdrawalsQuery, [mvrId]);
      const withdrawals = withdrawalsResult.rows;

      const accidentsQuery = `
      SELECT 
        accident_date,
        location,
        acd_code,
        description
      FROM accident_reports
      WHERE mvr_id = $1
      ORDER BY accident_date DESC
    `;
      const accidentsResult = await client.query(accidentsQuery, [mvrId]);
      const accidents = accidentsResult.rows;

      const crimesQuery = `
      SELECT 
        crime_date,
        conviction_date,
        offense_code,
        description
      FROM traffic_crimes
      WHERE mvr_id = $1
      ORDER BY crime_date DESC
    `;
      const crimesResult = await client.query(crimesQuery, [mvrId]);
      const crimes = crimesResult.rows;

      const transactionQuery = `
      SELECT 
        seller_id,
        buyer_id,
        state_code
      FROM transactions
      WHERE mvr_id = $1
    `;
      const transactionResult = await client.query(transactionQuery, [mvrId]);
      const transaction = transactionResult.rows[0] || null;

      const mvrRecord = {
        drivers_license_number: user.drivers_license_number,
        full_legal_name: user.full_legal_name,
        birthdate: user.birthdate,
        weight: user.weight,
        sex: user.sex,
        height: user.height,
        hair_color: user.hair_color,
        eye_color: user.eye_color,
        medical_information: user.medical_information,
        address: user.address,
        city: user.city,
        issued_state_code: user.issued_state_code,

        claim_number: mvr.claim_number,
        order_id: mvr.order_id,
        order_date: mvr.order_date,
        report_date: mvr.report_date,
        reference_number: mvr.reference_number,
        system_use: mvr.system_use,
        mvr_type: mvr.mvr_type,
        state_code: mvr.state_code,
        purpose: mvr.purpose,
        time_frame: mvr.time_frame,
        is_certified: mvr.is_certified,
        total_points: mvr.total_points,

        licenseInfo,
        violations,
        withdrawals,
        accidents,
        crimes,
        transaction,
      };

      await logToFirehose(user);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mvrRecord),
      };
    } catch (error: any) {
      console.error("Error retrieving MVR record:", error);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: error.message || "Internal server error",
        }),
      };
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Lambda handler error:", error);
    throw error;
  }
};
