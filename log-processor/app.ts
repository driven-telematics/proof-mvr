/* eslint-disable prettier/prettier */
import { FirehoseTransformationHandler, FirehoseTransformationEvent, FirehoseTransformationResult, FirehoseTransformationResultRecord } from 'aws-lambda';
import {
  FirehoseClient,
  PutRecordCommand
} from "@aws-sdk/client-firehose";

interface ProcessedLogRecord {
  timestamp: string;
  date: string;
  hour: string;
  operation: string;
  user_id?: string;
  company_id: string;
  drivers_id?: string;
  success: boolean;
  function_name: string;
  drivers_license_number?: string;
  affected_records_count: number;
  error_message?: string;
  operation_category: 'READ' | 'WRITE' | 'DELETE';
  raw_log: string;
  s3_partition: string;
  year: string;
  month: string;
  day: string;
  action: string;
}

// were logging who grabbed it, but we need who it was bought from. That is who needs to be audited not the retriever 
// we need both but the one who put it in is more important 

const firehose = new FirehoseClient({ region: process.env.AWS_REGION || "us-east-1" });
const DELIVERY_STREAM = process.env.INDIVIDUAL_AUDIT_STREAM_NAME || "IndividualAuditStream";


async function sendAuditLog(logEntry: ProcessedLogRecord): Promise<void> {
  console.log(`Attempting to send to Firehose: ${DELIVERY_STREAM}`);
  console.log(`Payload:`, JSON.stringify(logEntry, null, 2));
  
  try {
    const command = new PutRecordCommand({
      DeliveryStreamName: DELIVERY_STREAM,
      Record: { Data: Buffer.from(JSON.stringify(logEntry) + "\n") }
    });
    
    const response = await firehose.send(command);
    console.log(`Firehose response:`, response);
  } catch (error) {
    console.error(`Firehose error:`, error);
    throw error;
  }
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

function processLogEntry(logEntry: any): ProcessedLogRecord {
  const timestamp = logEntry.timestamp || new Date().toISOString();
  const dateParts = getDateParts(timestamp);

  let companyId = logEntry.company_id || logEntry.user_id || 'unknown';
  companyId = String(companyId).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);

  if (!companyId || companyId === '') {
    companyId = 'unknown';
  }

  console.log(`Processing log entry: original_company_id=${logEntry.company_id}, user_id=${logEntry.user_id}, final_company_id=${companyId}`);

  const companyPartition = generateCompanyS3Partition(
    companyId,
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
    company_id: companyId,
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
    action: logEntry.operation || 'unknown',
    s3_partition: companyPartition,
    raw_log: JSON.stringify(logEntry),
  };

  return processedRecord;
}

function generateCompanyS3Partition(
  companyId: string,
  action: string,
  year: string,
  month: string,
  day: string
): string {
  return `company=${companyId}/action=${action}/year=${year}/month=${month}/day=${day}`;
}

export const lambdaHandler: FirehoseTransformationHandler = 
  async (event: FirehoseTransformationEvent): Promise<FirehoseTransformationResult> => {
    const output: FirehoseTransformationResultRecord[] = [];
    
    console.log("attempting to run lambdahandler in log-processor function");
    for (const r of event.records) {
      try {
        const raw = JSON.parse(Buffer.from(r.data, "base64").toString("utf8"));
        const processed = processLogEntry(raw);

        if (!processed.s3_partition) {
          throw new Error("Missing s3_partition in processed record");
        }

        const dateParts = getDateParts(processed.timestamp);
        const action = processed.action;
        
        const transformedRecord: FirehoseTransformationResultRecord = {
          recordId: r.recordId,
          result: "Ok",
          data: Buffer.from(JSON.stringify(processed) + "\n").toString("base64"),
          metadata: {
            partitionKeys: {
              company_id: processed.company_id,
              action: action,
              year: dateParts.year,
              month: dateParts.month,
              day: dateParts.day
            },
          },
        };


        console.log(`Record ${r.recordId}: company_id=${processed.company_id}, action=${action}, year=${dateParts.year}, month=${dateParts.month}, day=${dateParts.day}`);

        try {
          await sendAuditLog(processed);
        } catch (err) {
          console.error("Firehose log failed:", err);
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