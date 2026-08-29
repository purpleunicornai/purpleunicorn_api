import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import {
  CreateProjectDto,
  ProjectDto,
  UpdateProjectDto,
} from '../common/dto/project.dto';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { ClerkAuthContext } from '../auth/auth.types';
import { RequestException } from '../common/exception/core/ExceptionBase';
import { Serialize } from '../common/interceptors/serialize.interceptor';

@ApiTags('Projects')
@ApiBearerAuth('bearer')
@UseGuards(ClerkAuthGuard)
@Controller('projects')
export class ProjectsController {
  logger = new Logger(ProjectsController.name);
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @Serialize(ProjectDto)
  async findAll(@CurrentAuth() auth: ClerkAuthContext) {
    const orgId = this.requireOrgId(auth);
    return this.projectsService.findAllForOrg(orgId, auth.userId);
  }

  @Get(':id')
  @Serialize(ProjectDto)
  async findOne(
    @Param('id') id: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = this.requireOrgId(auth);
    return this.projectsService.findOneForUser(id, orgId, auth.userId);
  }

  @Post()
  @Serialize(ProjectDto)
  async create(
    @Body() body: CreateProjectDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = this.requireOrgId(auth);
    return this.projectsService.create(body, auth.userId, orgId);
  }

  @Patch(':id')
  @Serialize(ProjectDto)
  async update(
    @Param('id') id: string,
    @Body() body: UpdateProjectDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = this.requireOrgId(auth);
    return this.projectsService.update(id, body, auth.userId, orgId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentAuth() auth: ClerkAuthContext) {
    const orgId = this.requireOrgId(auth);
    await this.projectsService.remove(id, auth.userId, orgId);
    return { success: true };
  }

  private requireOrgId(auth: ClerkAuthContext): string {
    if (!auth.orgId) {
      throw new RequestException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST,
        'NO_ACTIVE_ORGANIZATION',
      );
    }
    return auth.orgId;
  }
}
