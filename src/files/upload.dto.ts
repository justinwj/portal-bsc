import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
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
  @Transform(({ value }) => typeof value === 'string' ? (value ? [value] : []) : value)
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  recipientIds: string[] = [];
}
