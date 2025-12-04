/* eslint-disable prettier/prettier */
import { FirehoseTransformationHandler, FirehoseTransformationEvent, FirehoseTransformationResult, FirehoseTransformationResultRecord } from 'aws-lambda';

interface AccessorInfo {
  company_id: string;
  user_id: string;
  access_timestamp: string;
}

interface SellerInfo {
  seller_id: string;
  buyer_id: string;
  transaction_state: string;
  company_id?: string;
}

interface AuditLogRecord {
  timestamp: string;
  operation: string;
  company_id: string;
  success: boolean;
  function_name: string;
  drivers_license_number?: string;
  affected_records_count: number;
  operation_category: 'READ' | 'WRITE' | 'DELETE';
  year: string;
  month: string;
  day: string;
  action: string;

  accessor?: AccessorInfo;
  seller?: SellerInfo | null;
  mvr_data?: any;
  mvr_id?: number;
  full_legal_name?: string;
  issued_state_code?: string;
  [key: string]: any;
}

function getDateParts(timestamp: string) {
  const date = new Date(timestamp);
  return {
    year: date.getFullYear().toString(),
    month: (date.getMonth() + 1).toString().padStart(2, '0'),
    day: date.getDate().toString().padStart(2, '0')
  };
}

export const lambdaHandler: FirehoseTransformationHandler =
  async (event: FirehoseTransformationEvent): Promise<FirehoseTransformationResult> => {
    const output: FirehoseTransformationResultRecord[] = [];


    for (const record of event.records) {
      try {
        const rawData = Buffer.from(record.data, "base64").toString("utf8");
        const logEntry: AuditLogRecord = JSON.parse(rawData);



        // make sure this is for get 
        if (!logEntry.operation || !logEntry.operation.includes('GET_MVR')) {
          console.log(`Skipping non-GET-MVR operation: ${logEntry.operation}`);
          output.push({
            recordId: record.recordId,
            result: "Dropped",
            data: record.data
          });
          continue;
        }

        const dateParts = getDateParts(logEntry.timestamp);
        const accessorCompanyId = logEntry.accessor?.company_id;
        const sellerCompanyId = logEntry.seller?.company_id;

        console.log(`Accessor company: ${accessorCompanyId}, Seller company: ${sellerCompanyId}`);


        if (!sellerCompanyId) {
          console.log('Missing seller company_id, skipping mirroring');
          output.push({
            recordId: record.recordId,
            result: "Dropped",
            data: record.data
          });
          continue;
        }


        if (accessorCompanyId === sellerCompanyId) {
          console.log('Accessor and seller are the same company, no mirroring needed');
          output.push({
            recordId: record.recordId,
            result: "Dropped",
            data: record.data
          });
          continue;
        }


        console.log(`Creating mirror for seller/uploader company: ${sellerCompanyId}`);
        console.log(`MVR was retrieved by: ${accessorCompanyId || 'unknown'}`);

        const sellerRecord: FirehoseTransformationResultRecord = {
          recordId: record.recordId,
          result: "Ok",
          data: Buffer.from(JSON.stringify({
            ...logEntry,
            mirroring_target: 'seller',
            target_company_id: sellerCompanyId,
            retrieved_by_company_id: accessorCompanyId || 'unknown'
          }) + "\n").toString("base64"),
          metadata: {
            partitionKeys: {
              company_id: sellerCompanyId,
              action: 'MVR-RETRIEVED',
              year: dateParts.year,
              month: dateParts.month,
              day: dateParts.day
            }
          }
        };

        output.push(sellerRecord);
        console.log(`Created mirror record for seller (${sellerCompanyId}) - MVR retrieved by (${accessorCompanyId})`);

      } catch (err) {
        console.error("Error processing record:", err, "Raw data:", record.data);
        output.push({
          recordId: record.recordId,
          result: "ProcessingFailed",
          data: record.data
        });
      }
    }

    console.log(`Mirroring Processor: Processed ${event.records.length} input records, generated ${output.length} output records`);
    return { records: output };
  };
