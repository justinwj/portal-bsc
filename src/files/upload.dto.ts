import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { managedVisibilities, ManagedVisibility } from '../common/file-visibility';
export class UploadIntentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  originalFilename: string;
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;
  @IsString()
  @MaxLength(2000)
  description: string;
  @IsString()
  @MaxLength(16)
  sizeBytes: string;
  @IsUUID('4')
  idempotencyKey: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(managedVisibilities)
  visibility?: ManagedVisibility;
}
export class UploadPolicyDto {
  @IsString()
  @MaxLength(64)
  maxUploadGb: string;
  @IsIn(['yes'])
  confirm: string;
  @IsOptional()
  @IsIn(['yes'])
  useRecommended?: string;
}
export class SharingDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(managedVisibilities)
  visibility?: ManagedVisibility;
  @Transform(({ value }) => typeof value === 'string' ? (value ? [value] : []) : value)
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  recipientIds: string[] = [];
}
