/* eslint-disable prettier/prettier */


export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}


export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}


export class HttpError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'HttpError';
  }
}


interface FieldConfig {
  required?: boolean;
  allowNull?: boolean;
  allowEmpty?: boolean;
  allowOther?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  customValidator?: (value: any) => { valid: boolean; message?: string };
}


type ValidationSchema = Record<string, FieldConfig>;


function validateField(
  fieldName: string,
  value: any,
  config: FieldConfig
): ValidationError | null {
  if (config.required) {
    if (value === undefined || value === null) {
      return {
        field: fieldName,
        message: `${fieldName} is required and cannot be null or undefined`,
        value
      };
    }

    if (!config.allowEmpty && typeof value === 'string' && value.trim() === '') {
      return {
        field: fieldName,
        message: `${fieldName} is required and cannot be empty`,
        value
      };
    }
  }

  if (value === null || value === undefined) {
    if (!config.required) {
      return null;
    }
  }

  if (!config.allowOther && typeof value === 'string') {
    if (value.toLowerCase() === 'other') {
      return {
        field: fieldName,
        message: `${fieldName} cannot be 'Other'. Please provide a valid value`,
        value
      };
    }
  }

  if (config.type && value !== null && value !== undefined) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== config.type) {
      return {
        field: fieldName,
        message: `${fieldName} must be of type ${config.type}, received ${actualType}`,
        value
      };
    }
  }

  if (config.customValidator && value !== null && value !== undefined) {
    const result = config.customValidator(value);
    if (!result.valid) {
      return {
        field: fieldName,
        message: result.message || `${fieldName} failed custom validation`,
        value
      };
    }
  }

  return null;
}


export function validateSchema(
  data: Record<string, any>,
  schema: ValidationSchema
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const [fieldName, config] of Object.entries(schema)) {
    const value = data[fieldName];
    const error = validateField(fieldName, value, config);
    if (error) {
      errors.push(error);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}


export function validateOrThrow(
  data: Record<string, any>,
  schema: ValidationSchema,
  statusCode = 400
): void {
  const result = validateSchema(data, schema);
  if (!result.isValid) {
    const errorMessage = result.errors.map(e => e.message).join('; ');
    throw new HttpError(errorMessage, statusCode);
  }
}


export const validators = {
  permissiblePurpose: (value: any) => {
    const validPurposes = [
      'EMPLOYMENT',
      'INSURANCE',
      'LEGAL',
      'GOVERNMENT',
      'UNDERWRITING',
      'FRAUD'
    ];
    return {
      valid: typeof value === 'string' && validPurposes.includes(value),
      message: `permissible_purpose must be one of: ${validPurposes.join(', ')}`
    };
  },


  consentRequired: (value: any) => {
    return {
      valid: value === true,
      message: 'Consent is required and must be true'
    };
  },


  nonNegativeNumber: (value: any) => {
    const num = Number(value);
    return {
      valid: !isNaN(num) && num >= 0,
      message: 'Value must be a non-negative number'
    };
  },


  integer: (value: any) => {
    const num = Number(value);
    return {
      valid: !isNaN(num) && Number.isInteger(num),
      message: 'Value must be an integer'
    };
  },


  positiveInteger: (value: any) => {
    const num = Number(value);
    return {
      valid: !isNaN(num) && Number.isInteger(num) && num > 0,
      message: 'Value must be a positive integer'
    };
  },


  nonEmptyArray: (value: any) => {
    return {
      valid: Array.isArray(value) && value.length > 0,
      message: 'Value must be a non-empty array'
    };
  },


  driversLicenseNumber: (value: any) => {
    return {
      valid: typeof value === 'string' && value.trim().length > 0,
      message: 'drivers_license_number must be a non-empty string'
    };
  },

  redisclosureAuthorization: (value: any) => {
    return {
      valid: value === true,
      message: 'redisclosure_authorization is required and must be true'
    };
  }
};


export const schemas = {
  addMvr: {
    company_id: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const
    },
    permissible_purpose: {
      required: true,
      allowOther: false,
      type: 'string' as const,
      customValidator: validators.permissiblePurpose
    },
    price_paid: {
      required: true,
      type: 'number' as const,
      customValidator: validators.nonNegativeNumber
    },
    redisclosure_authorization: {
      required: true,
      type: 'boolean' as const,
      customValidator: validators.redisclosureAuthorization
    },
    storage_limitations: {
      required: false,
      type: 'number' as const,
      customValidator: validators.nonNegativeNumber
    }
  },


  addMvrData: {
    drivers_license_number: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const,
      customValidator: validators.driversLicenseNumber
    },
    full_legal_name: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const
    },
    birthdate: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const
    },
    weight: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const
    },
    sex: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const
    },
    height: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const
    },
    hair_color: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const
    },
    eye_color: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const
    },
    issued_state_code: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const
    },
    state_code: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const
    }
  },


  getMvr: {
    drivers_license_number: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const,
      customValidator: validators.driversLicenseNumber
    },
    company_id: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const
    },
    permissible_purpose: {
      required: true,
      allowOther: false,
      type: 'string' as const,
      customValidator: validators.permissiblePurpose
    },
    days: {
      required: true,
      type: 'number' as const,
      customValidator: (value: any) => {
        const intResult = validators.integer(value);
        if (!intResult.valid) return intResult;

        const nonNegResult = validators.nonNegativeNumber(value);
        return nonNegResult;
      }
    },
    consent: {
      required: true,
      type: 'boolean' as const,
      customValidator: validators.consentRequired
    }
  },

 
  batchAddMvr: {
    company_id: {
      required: true,
      allowEmpty: false,
      allowOther: false,
      type: 'string' as const
    },
    permissible_purpose: {
      required: true,
      allowOther: false,
      type: 'string' as const,
      customValidator: validators.permissiblePurpose
    },
    batch_mvrs: {
      required: true,
      type: 'array' as const,
      customValidator: validators.nonEmptyArray
    }
  }
};


export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map(e => e.message).join('; ');
}


export function createErrorResponse(
  statusCode: number,
  message: string,
  errors?: ValidationError[]
) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: message,
      details: errors?.map(e => ({
        field: e.field,
        message: e.message
      }))
    })
  };
}
