/* eslint-disable prettier/prettier */
import { FirehoseTransformationHandler, FirehoseTransformationEvent, FirehoseTransformationResult, FirehoseTransformationResultRecord } from 'aws-lambda';
import {
  FirehoseClient,
  PutRecordCommand
} from "@aws-sdk/client-firehose";

interface AccessorInfo {
  company_id: string;
  user_id: string;
  access_timestamp: string;
}

interface CreatorInfo {
  company_id: string;
  upload_timestamp: string;
  operation_type: string;
}

interface SellerInfo {
  seller_id: string;
  buyer_id: string;
  transaction_state: string;
  company_id?: string;
}

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


  accessor?: AccessorInfo;      
  creator?: CreatorInfo;       
  seller?: SellerInfo | null;    
  mvr_data?: any;           
  mvr_id?: number;               
  full_legal_name?: string;      
  issued_state_code?: string;    
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

const firehose = new FirehoseClient({ region: process.env.AWS_REGION || "us-east-1" });
const MIRRORING_STREAM = process.env.MIRRORING_AUDIT_STREAM_NAME || "MirroringAuditStream";

async function sendToMirroringStream(logEntry: any): Promise<void> {
  console.log(`Sending GET-MVR log to mirroring stream: ${MIRRORING_STREAM}`);
  console.log(`Log entry:`, JSON.stringify(logEntry, null, 2));

  try {
    const command = new PutRecordCommand({
      DeliveryStreamName: MIRRORING_STREAM,
      Record: { Data: Buffer.from(JSON.stringify(logEntry) + "\n") }
    });

    const response = await firehose.send(command);
    console.log(`Mirroring stream response:`, response);
  } catch (error) {
    console.error(`Mirroring stream error:`, error);
  }
}

export const lambdaHandler: FirehoseTransformationHandler =
  async (event: FirehoseTransformationEvent): Promise<FirehoseTransformationResult> => {
    const output: FirehoseTransformationResultRecord[] = [];

    for (const r of event.records) {
      try {
        const raw = JSON.parse(Buffer.from(r.data, "base64").toString("utf8"));

        if (!raw.drivers_license_number) {
          throw new Error("Missing drivers_license_number in record");
        }

        const dateParts = getDateParts(raw.timestamp);
        const action = raw.action || raw.operation || 'UNKNOWN';

        const transformedRecord: FirehoseTransformationResultRecord = {
          recordId: r.recordId,
          result: "Ok",
          data: Buffer.from(JSON.stringify(raw) + "\n").toString("base64"),
          metadata: {
            partitionKeys: {
              drivers_license_number: raw.drivers_license_number,
              action: action,
              year: dateParts.year,
              month: dateParts.month,
              day: dateParts.day
            },
          },
        };

        console.log(`Record ${r.recordId}: drivers_license_number=${raw.drivers_license_number}, action=${action}, year=${dateParts.year}, month=${dateParts.month}, day=${dateParts.day}`);

        // send off extra stream for get
        if (action && action.includes('GET_MVR')) {
          console.log(`Detected GET-MVR operation, triggering mirroring stream`);
          try {
            await sendToMirroringStream(raw);
            console.log(`Successfully sent to mirroring stream`);
          } catch (mirrorErr) {
            console.error(`Failed to send to mirroring stream:`, mirrorErr);

          }
        }

        output.push(transformedRecord);
      } catch (err) {
        console.error("Bad record:", err, "Raw data:", r.data);
        const failedRecord: FirehoseTransformationResultRecord = {
          recordId: r.recordId,
          result: "ProcessingFailed",
          data: r.data,
        };
        output.push(failedRecord);
      }
    }

    return { records: output };
};


// function processLogEntry(logEntry: any): ProcessedLogRecord {
//   const timestamp = logEntry.timestamp || new Date().toISOString();
//   const dateParts = getDateParts(timestamp);


//   let company_id = logEntry.company_id || logEntry.user_id || 'unknown';
//   company_id = String(company_id).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

//   let drivers_id = logEntry.drivers_id || logEntry.user_id || 'unknown';
//   drivers_id = String(drivers_id).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

//   if (!company_id || company_id === '') {
//     company_id = 'unknown';
//   }

//   console.log(`Processing log entry: original_company_id=${logEntry.company_id}, user_id=${logEntry.user_id}, final_company_id=${company_id}`);

//   const pgauditLog = formatPgAuditLog(logEntry, timestamp);

//   const companyPartition = generateCompanyS3Partition(
//     drivers_id,
//     company_id,
//     logEntry.operation,
//     dateParts.year,
//     dateParts.month,
//     dateParts.day
//   );

//   const processedRecord: ProcessedLogRecord = {
//     timestamp,
//     date: dateParts.dateStr,
//     hour: dateParts.hour,
//     operation: logEntry.operation || 'UNKNOWN',
//     user_id: logEntry.user_id,
//     company_id: company_id,
//     drivers_id: logEntry.drivers_id,
//     success: logEntry.success !== undefined ? logEntry.success : true,
//     function_name: logEntry.function_name || 'unknown',
//     drivers_license_number: logEntry.drivers_license_number,
//     affected_records_count: logEntry.affected_records_count || 0,
//     error_message: logEntry.error_message,
//     operation_category: logEntry.operation_category || 'UNKNOWN',
//     year: dateParts.year,
//     month: dateParts.month,
//     day: dateParts.day,
//     action: logEntry.statement || 'unknown',
//     pgaudit_formatted: pgauditLog,
//     s3_partition: companyPartition,
//     raw_log: JSON.stringify(logEntry),

//     // Pass through enhanced audit fields
//     accessor: logEntry.accessor,
//     creator: logEntry.creator,
//     seller: logEntry.seller,
//     mvr_data: logEntry.mvr_data,
//     mvr_id: logEntry.mvr_id,
//     full_legal_name: logEntry.full_legal_name,
//     issued_state_code: logEntry.issued_state_code
//   };

//   return processedRecord;
// }

// function generateCompanyS3Partition(
//   drivers_id: string,
//   company_id: string,
//   action: string,
//   year: string,
//   month: string,
//   day: string
// ): string {
//   return `drivers_id=${drivers_id}/year=${year}/month=${month}/day=${day}/action=${action}/company=${company_id}`;
// }

// function formatPgAuditLog(logEntry: any, timestamp: string): string {
//   const pgauditEntry: PgAuditLogEntry = {
//     timestamp: timestamp,
//     user: logEntry.user_id || 'system',
//     database: logEntry.database || 'application',
//     client_addr: logEntry.client_addr || '127.0.0.1',
//     object_type: logEntry.object_type || 'table',
//     object_name: logEntry.object_name || 'drivers_data',
//     statement: logEntry.statement || `${logEntry.operation || 'UNKNOWN'} operation`,
//     success: logEntry.success !== undefined ? logEntry.success : true,
//     error_message: logEntry.error_message,
//     drivers_id: logEntry.drivers_id || 'unknown',
//     action: logEntry.operation || 'unknown',
//     year: logEntry.year || new Date(timestamp).getFullYear().toString(),
//     month: logEntry.month || (new Date(timestamp).getMonth() + 1).toString().padStart(2, '0'),
//     day: logEntry.day || new Date(timestamp).getDate().toString().padStart(2, '0')
//   };

//   return [
//     'AUDIT:',
//     'SESSION',
//     pgauditEntry.timestamp,
//     pgauditEntry.user,
//     pgauditEntry.database,
//     pgauditEntry.client_addr,
//     pgauditEntry.object_type,
//     pgauditEntry.object_name,
//     pgauditEntry.statement,
//     `SUCCESS:${pgauditEntry.success}`,
//     pgauditEntry.action,
//     pgauditEntry.year,
//     pgauditEntry.month,
//     pgauditEntry.day,
//     pgauditEntry.error_message ? `ERROR:${pgauditEntry.error_message}` : ''
//   ].filter(Boolean).join(',');
// }


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