import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OrganizationLogType } from '../../generated/prisma/enums';

export interface LogEntryInput {
  organization_id: string;
  type: OrganizationLogType;
  user_id?: string;
  message?: string;
  tokens_used?: number;
  project_id?: string;
  role_id?: string;
  role_filter_id?: string;
  role_result_id?: string;
}

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Best-effort: an audit-log write failing must never fail the action it
  // describes, so failures are caught and warned rather than thrown.
  async log(entry: LogEntryInput): Promise<void> {
    try {
      await this.prisma.organization_log.create({ data: entry });
    } catch (error) {
      this.logger.warn(
        `Failed to write organization_log (${entry.type}) for organization=${entry.organization_id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
