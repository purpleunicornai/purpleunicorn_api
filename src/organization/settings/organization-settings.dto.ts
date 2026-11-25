import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateOrganizationSettingsDto {
  @ApiProperty({
    description:
      'Reasoning model, one of supportedModels from GET /organization/settings (the provider follows from it); null goes back to the default.',
    example: 'gemini-2.5-pro',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString()
  aiModel?: string | null;
}
