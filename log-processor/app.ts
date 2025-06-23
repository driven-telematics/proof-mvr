/* eslint-disable prettier/prettier */
import { FirehoseTransformationHandler, FirehoseTransformationEvent, FirehoseTransformationResult } from 'aws-lambda';

interface ProcessedLogRecord {
  timestamp: string;
  date: string;
  hour: string;
  operation: string;
  user_id?: string;
  user_ip?: string;
  success: boolean;
  function_name: string;
  request_id: string;
  drivers_license_number?: string;
  affected_records_count?: number;
  execution_time_ms?: number;
  data_sensitivity: string;
  error_message?: string;
  
  operation_category: 'READ' | 'WRITE' | 'DELETE';
  risk_score: number;
  compliance_flags: string[];
  
  raw_log: string;
}

export const lambdaHandler: FirehoseTransformationHandler = async (
  event: FirehoseTransformationEvent
): Promise<FirehoseTransformationResult> => {
  console.log('Processing', event.records.length, 'log records');
  
  const output = event.records.map((record) => {
    try {
      const data = Buffer.from(record.data, 'base64').toString('utf8');
      const logEntry = JSON.parse(data.trim());
      
      const processedRecord = processLogEntry(logEntry);
      
      const processedData = JSON.stringify(processedRecord) + '\n';
      const encodedData = Buffer.from(processedData).toString('base64');
      
      return {
        recordId: record.recordId,
        result: 'Ok' as const,
        data: encodedData
      };
    } catch (error) {
      console.error('Error processing record:', error);
      
      return {
        recordId: record.recordId,
        result: 'ProcessingFailed' as const,
        data: record.data
      };
    }
  });

  return { records: output };
};

function processLogEntry(logEntry: any): ProcessedLogRecord {
  const timestamp = logEntry.timestamp || new Date().toISOString();
  const date = new Date(timestamp);
  
  const dateStr = date.toISOString().split('T')[0];
  const hour = date.getUTCHours().toString().padStart(2, '0');
  
  const operationCategory = categorizeOperation(logEntry.operation);
  
  const riskScore = calculateRiskScore(logEntry);
  
  const complianceFlags = identifyComplianceFlags(logEntry);
  
  const processedRecord: ProcessedLogRecord = {
    timestamp,
    date: dateStr,
    hour,
    operation: logEntry.operation,
    user_id: logEntry.user_id,
    user_ip: logEntry.user_ip,
    success: logEntry.success,
    function_name: logEntry.function_name,
    request_id: logEntry.request_id,
    drivers_license_number: maskLicenseNumber(logEntry.drivers_license_number),
    affected_records_count: logEntry.affected_records_count || 0,
    execution_time_ms: logEntry.execution_time_ms || 0,
    data_sensitivity: logEntry.data_sensitivity,
    error_message: logEntry.error_message,
    
    operation_category: operationCategory,
    risk_score: riskScore,
    compliance_flags: complianceFlags,
    
    raw_log: JSON.stringify(logEntry)
  };
  
  return processedRecord;
}


function categorizeOperation(operation: string): 'READ' | 'WRITE' | 'DELETE' {
    switch (operation.toUpperCase()) {
      case 'GET':
      case 'FETCH':
      case 'READ':
        return 'READ';
      case 'ADD':
      case 'CREATE':
      case 'UPDATE':
      case 'MODIFY':
      case 'BATCH_ADD':
        return 'WRITE';
      case 'DELETE':
      case 'REMOVE':
        return 'DELETE';
      default:
        return 'READ'; 
    }
  }
  
  function calculateRiskScore(logEntry: any): number {
    let score = 0;
    if (!logEntry.success) score += 30;
    if (logEntry.data_sensitivity === 'HIGH') score += 40;
    if (logEntry.operation === 'DELETE') score += 20;
    if (logEntry.drivers_license_number) score += 10;
    return Math.min(score, 100);
  }
  
  function identifyComplianceFlags(logEntry: any): string[] {
    const flags: string[] = [];
    if (!logEntry.user_id) flags.push('NO_USER_ID');
    if (logEntry.data_sensitivity === 'HIGH' && !logEntry.success) flags.push('FAILED_HIGH_SENSITIVITY');
    if (logEntry.operation === 'DELETE' && !logEntry.success) flags.push('FAILED_DELETE');
    return flags;
  }
  
  function maskLicenseNumber(dlNumber?: string): string | undefined {
    if (!dlNumber || dlNumber.length < 4) return undefined;
    return '*'.repeat(dlNumber.length - 4) + dlNumber.slice(-4);
  }