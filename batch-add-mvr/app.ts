/* eslint-disable prettier/prettier */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Pool } from 'pg';
import { format, subDays } from 'date-fns';



const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
  ssl: {
    rejectUnauthorized: false 
  }
});

interface MVRData {
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
  
  violations?: Array<{
    violation_date: string;
    conviction_date?: string;
    location?: string;
    points_assessed?: number;
    violation_code?: string;
    description?: string;
  }>;
  
  withdrawals?: Array<{
    effective_date: string;
    eligibility_date?: string;
    action_type?: string;
    reason?: string;
  }>;
  
  accidents?: Array<{
    accident_date: string;
    location?: string;
    acd_code?: string;
    description?: string;
  }>;
  
  crimes?: Array<{
    crime_date: string;
    conviction_date?: string;
    offense_code?: string;
    description?: string;
  }>;
  
  transaction?: {
    seller_id?: number;
    buyer_id?: number;
  };
}

interface BatchProcessResult {
  success: boolean;
  message: string;
  mvr_id?: number;
  error?: string;
  drivers_license_number: string;
}

async function checkExistingUser(client: any, driversLicense: string): Promise<{ userId: number | null, currentMvrId: number | null, hasRecentMvr: boolean }> {
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
  
  const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
  
  const mvrQuery = `
    SELECT id 
    FROM mvr_records 
    WHERE id = $1 AND order_date >= $2
  `;
  
  const mvrResult = await client.query(mvrQuery, [currentMvrId, thirtyDaysAgo]);
  const hasRecentMvr = mvrResult.rows.length > 0;
  
  return { userId, currentMvrId, hasRecentMvr };
}

async function createMvrRecord(client: any, mvrData: MVRData): Promise<number> {
  const query = `
    INSERT INTO mvr_records (
      claim_number, order_id, order_date, report_date, 
      reference_number, system_use, mvr_type, state_code, 
      purpose, time_frame, is_certified, total_points
    ) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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

async function createUser(client: any, mvrData: MVRData, mvrId: number): Promise<number> {
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

async function updateUserMvrId(client: any, userId: number, mvrId: number): Promise<void> {
  const query = `
    UPDATE users 
    SET current_mvr_id = $1 
    WHERE id = $2
  `;
  
  await client.query(query, [mvrId, userId]);
}

async function addDriverLicenseInfo(client: any, mvrData: MVRData, mvrId: number): Promise<void> {
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

async function addTrafficViolations(client: any, violations: any[], mvrId: number): Promise<void> {
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

async function addWithdrawals(client: any, withdrawals: any[], mvrId: number): Promise<void> {
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

async function addAccidents(client: any, accidents: any[], mvrId: number): Promise<void> {
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

async function addTrafficCrimes(client: any, crimes: any[], mvrId: number): Promise<void> {
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

async function addTransaction(client: any, transaction: any, mvrId: number, stateCode: string): Promise<void> {
  if (!transaction) {
    return;
  }
  
  const query = `
    INSERT INTO transactions (
      mvr_id, seller_id, buyer_id, state_code
    ) 
    VALUES ($1, $2, $3, $4)
  `;
  
  const params = [
    mvrId,
    transaction.seller_id || null,
    transaction.buyer_id || null,
    stateCode
  ];
  
  await client.query(query, params);
}

async function processSingleMvr(client: any, mvrData: MVRData): Promise<BatchProcessResult> {
  try {
    if (!mvrData.drivers_license_number) {
      return {
        success: false,
        message: 'Required fields missing',
        error: 'Driver\'s license number is required',
        drivers_license_number: 'unknown'
      };
    }

    const { userId, hasRecentMvr } = await checkExistingUser(client, mvrData.drivers_license_number);

    if (userId && hasRecentMvr) {
      return {
        success: true,
        message: 'MVR uploaded less than 30 days ago',
        drivers_license_number: mvrData.drivers_license_number
      };
    }

    const mvrId = await createMvrRecord(client, mvrData);

    if (userId) {
      await updateUserMvrId(client, userId, mvrId);
    } else {
      await createUser(client, mvrData, mvrId);
    }

    await addDriverLicenseInfo(client, mvrData, mvrId);
    await addTrafficViolations(client, mvrData.violations || [], mvrId);
    await addWithdrawals(client, mvrData.withdrawals || [], mvrId);
    await addAccidents(client, mvrData.accidents || [], mvrId);
    await addTrafficCrimes(client, mvrData.crimes || [], mvrId);
    await addTransaction(client, mvrData.transaction, mvrId, mvrData.state_code);

    return {
      success: true,
      message: userId ? 'User MVR updated successfully' : 'New user and MVR created successfully',
      mvr_id: mvrId,
      drivers_license_number: mvrData.drivers_license_number
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'Error processing MVR',
      error: error.message || 'Unknown error',
      drivers_license_number: mvrData.drivers_license_number || 'unknown'
    };
  }
}

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const client = await pool.connect();
  const results: BatchProcessResult[] = [];
  
  try {
    if (!event.body) {
      throw new Error('Missing request body');
    }
    
    const requestData = JSON.parse(event.body);
    let mvrDataArray: MVRData[] = [];
    
    if (Array.isArray(requestData)) {
      mvrDataArray = requestData;
    } else {
      mvrDataArray = [requestData];
    }
    
    if (mvrDataArray.length === 0) {
      throw new Error('No MVR records provided');
    }
    
    await client.query('BEGIN');
    
    for (const mvrData of mvrDataArray) {
      const result = await processSingleMvr(client, mvrData);
      results.push(result);
    }
    
    if (results.some(result => !result.success)) {
      throw new Error('One or more MVR records failed to process');
    }
    
    await client.query('COMMIT');
    
    const totalRecords = results.length;
    const successCount = results.filter(r => r.success).length;
    const newRecords = results.filter(r => r.success && r.message.includes('New user')).length;
    const updatedRecords = results.filter(r => r.success && r.message.includes('updated')).length;
    const skippedRecords = results.filter(r => r.success && r.message.includes('less than 30 days')).length;
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Processed ${successCount}/${totalRecords} MVR records successfully`,
        summary: {
          total: totalRecords,
          successful: successCount,
          new_records: newRecords,
          updated_records: updatedRecords,
          skipped_records: skippedRecords
        },
        results: results
      })
    };
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error processing MVR batch:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: error.message || 'Internal server error',
        results: results
      })
    };
    
  } finally {
    client.release();
  }
};