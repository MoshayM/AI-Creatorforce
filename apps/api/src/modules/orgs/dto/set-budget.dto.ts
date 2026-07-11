import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SetBudgetDto {
  @IsOptional()
  @IsString()
  teamId?: string;

  @IsDate()
  @Type(() => Date)
  periodStart!: Date;

  @IsDate()
  @Type(() => Date)
  periodEnd!: Date;

  @IsInt()
  @Min(0)
  allocatedCredits!: number;

  @IsOptional()
  @IsBoolean()
  hardCap?: boolean;
}
