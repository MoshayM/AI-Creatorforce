import { IsBoolean, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsIn(['ORG_ADMIN', 'TEAM_MANAGER', 'BILLING_ADMIN', 'MEMBER'])
  role?: string;

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean;
}
