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