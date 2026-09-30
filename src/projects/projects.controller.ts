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
import { LogsService } from '../common/logs/logs.service';

@ApiTags('Projects')
@ApiBearerAuth('bearer')
@UseGuards(ClerkAuthGuard)
@Controller('projects')
export class ProjectsController {
  logger = new Logger(ProjectsController.name);
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly logsService: LogsService,
  ) {}

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
    const project = await this.projectsService.create(body, auth.userId, orgId);

    void this.logsService.log({
      organization_id: orgId,
      user_id: auth.userId,
      type: 'PROJECT_CREATED',
      project_id: project.uid,
      message: `Created project "${project.name}"`,
    });

    return project;
  }

  @Patch(':id')
  @Serialize(ProjectDto)
  async update(
    @Param('id') id: string,
    @Body() body: UpdateProjectDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = this.requireOrgId(auth);
    const { project, addedUsers, removedUsers } =
      await this.projectsService.update(id, body, auth.userId, orgId);

    const hasNonUserChanges =
      body.name !== undefined ||
      body.description !== undefined ||
      body.visibility !== undefined;
    if (hasNonUserChanges) {
      void this.logsService.log({
        organization_id: orgId,
        user_id: auth.userId,
        type: 'PROJECT_UPDATED',
        project_id: project.uid,
        message: `Updated project "${project.name}"`,
      });
    }
    if (addedUsers.length > 0) {
      void this.logsService.log({
        organization_id: orgId,
        user_id: auth.userId,
        type: 'PROJECT_USERS_ADDED',
        project_id: project.uid,
        message: `Added ${addedUsers.length} user(s) to project "${project.name}"`,
      });
    }
    if (removedUsers.length > 0) {
      void this.logsService.log({
        organization_id: orgId,
        user_id: auth.userId,
        type: 'PROJECT_USERS_REMOVED',
        project_id: project.uid,
        message: `Removed ${removedUsers.length} user(s) from project "${project.name}"`,
      });
    }

    return project;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentAuth() auth: ClerkAuthContext) {
    const orgId = this.requireOrgId(auth);
    const project = await this.projectsService.remove(id, auth.userId, orgId);

    void this.logsService.log({
      organization_id: orgId,
      user_id: auth.userId,
      type: 'PROJECT_DELETED',
      project_id: project.uid,
      message: `Deleted project "${project.name}"`,
    });

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
