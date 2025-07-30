/* eslint-disable prettier/prettier */
import { FirehoseTransformationHandler, FirehoseTransformationEvent, FirehoseTransformationResult, FirehoseTransformationResultRecord } from 'aws-lambda';

interface ProcessedLogRecord {
  timestamp: string;
  date: string;
  hour: string;
  operation: string;
  user_id?: string;
  company_id: string; 
  drivers_id: string;
  success: boolean;
  function_name: string;
  drivers_license_number?: string;
  affected_records_count: number;
  error_message?: string;
  operation_category: 'READ' | 'WRITE' | 'DELETE';
  raw_log: string;
  pgaudit_formatted: string;
  s3_partition: string;
  year: string; 
  month: string;
  day: string;
  action: string; 
}

interface PgAuditLogEntry {
  timestamp: string;
  user: string;
  database: string;
  client_addr: string;
  object_type: string;
  object_name: string;
  statement: string;
  success: boolean;
  error_message?: string;
  drivers_id: string;
  action: string; 
  year?: string;
  month?: string;
  day?: string;
}

export const lambdaHandler: FirehoseTransformationHandler = 
  async (event: FirehoseTransformationEvent): Promise<FirehoseTransformationResult> => {
    const output: FirehoseTransformationResultRecord[] = event.records.map(r => {
      try {
        const raw = JSON.parse(Buffer.from(r.data, "base64").toString("utf8"));
       
        if (!raw.s3_partition) {
          throw new Error("Missing s3_partition in processed record");
        }

        const dateParts = getDateParts(raw.timestamp);
        const action = raw.action 
        const transformedRecord: FirehoseTransformationResultRecord = {
          recordId: r.recordId,
          result: "Ok",
          data: Buffer.from(JSON.stringify(raw) + "\n").toString("base64"),
          metadata: {
            partitionKeys: {
              drivers_id: raw.drivers_id,
              action: action,
              year: dateParts.year,
              month: dateParts.month,
              day: dateParts.day
            },
          },
        };

        console.log(`Record ${r.recordId}: company_id=${raw.company_id}, action=${action}, year=${dateParts.year}, month=${dateParts.month}, day=${dateParts.day}`);

        return transformedRecord;
      } catch (err) {
        console.error("Bad record:", err, "Raw data:", r.data);
        const failedRecord: FirehoseTransformationResultRecord = {
          recordId: r.recordId,
          result: "ProcessingFailed",
          data: r.data,
        };
        return failedRecord;
      }
    });

    return { records: output };
};


function processLogEntry(logEntry: any): ProcessedLogRecord {
  const timestamp = logEntry.timestamp || new Date().toISOString();
  const dateParts = getDateParts(timestamp);


  let company_id = logEntry.company_id || logEntry.user_id || 'unknown';
  company_id = String(company_id).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

  let drivers_id = logEntry.drivers_id || logEntry.user_id || 'unknown';
  drivers_id = String(drivers_id).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

  if (!company_id || company_id === '') {
    company_id = 'unknown';
  }

  console.log(`Processing log entry: original_company_id=${logEntry.company_id}, user_id=${logEntry.user_id}, final_company_id=${company_id}`);

  const pgauditLog = formatPgAuditLog(logEntry, timestamp);

  const companyPartition = generateCompanyS3Partition(
    drivers_id,
    company_id,
    logEntry.operation,
    dateParts.year,
    dateParts.month,
    dateParts.day
  );

  const processedRecord: ProcessedLogRecord = {
    timestamp,
    date: dateParts.dateStr,
    hour: dateParts.hour,
    operation: logEntry.operation || 'UNKNOWN',
    user_id: logEntry.user_id,
    company_id: company_id,
    drivers_id: logEntry.drivers_id,
    success: logEntry.success !== undefined ? logEntry.success : true,
    function_name: logEntry.function_name || 'unknown',
    drivers_license_number: logEntry.drivers_license_number,
    affected_records_count: logEntry.affected_records_count || 0,
    error_message: logEntry.error_message,
    operation_category: logEntry.operation_category || 'UNKNOWN',
    year: dateParts.year,
    month: dateParts.month,
    day: dateParts.day,
    action: logEntry.statement || 'unknown',
    pgaudit_formatted: pgauditLog,
    s3_partition: companyPartition,
    raw_log: JSON.stringify(logEntry),
  };

  return processedRecord;
}

function generateCompanyS3Partition(
  drivers_id: string,
  company_id: string,
  action: string,
  year: string,
  month: string,
  day: string
): string {
  return `drivers_id=${drivers_id}/year=${year}/month=${month}/day=${day}/action=${action}/company=${company_id}`;
}

function formatPgAuditLog(logEntry: any, timestamp: string): string {
  const pgauditEntry: PgAuditLogEntry = {
    timestamp: timestamp,
    user: logEntry.user_id || 'system',
    database: logEntry.database || 'application',
    client_addr: logEntry.client_addr || '127.0.0.1',
    object_type: logEntry.object_type || 'table',
    object_name: logEntry.object_name || 'drivers_data',
    statement: logEntry.statement || `${logEntry.operation || 'UNKNOWN'} operation`,
    success: logEntry.success !== undefined ? logEntry.success : true,
    error_message: logEntry.error_message,
    drivers_id: logEntry.drivers_id || 'unknown',
    action: logEntry.operation || 'unknown',
    year: logEntry.year || new Date(timestamp).getFullYear().toString(),
    month: logEntry.month || (new Date(timestamp).getMonth() + 1).toString().padStart(2, '0'),
    day: logEntry.day || new Date(timestamp).getDate().toString().padStart(2, '0')
  };

  return [
    'AUDIT:',
    'SESSION',
    pgauditEntry.timestamp,
    pgauditEntry.user,
    pgauditEntry.database,
    pgauditEntry.client_addr,
    pgauditEntry.object_type,
    pgauditEntry.object_name,
    pgauditEntry.statement,
    `SUCCESS:${pgauditEntry.success}`,
    pgauditEntry.action,
    pgauditEntry.year,
    pgauditEntry.month,
    pgauditEntry.day,
    pgauditEntry.error_message ? `ERROR:${pgauditEntry.error_message}` : ''
  ].filter(Boolean).join(',');
}


function getDateParts(timestamp: string) {
  
  const date = new Date(timestamp);
  const parts = {
    dateStr: date.toISOString().split('T')[0],
    hour: date.getUTCHours().toString().padStart(2, '0'),
    year: date.getFullYear().toString(),
    month: (date.getMonth() + 1).toString().padStart(2, '0'),
    day: date.getDate().toString().padStart(2, '0')
  };
  
  return parts;
}