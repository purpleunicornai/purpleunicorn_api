import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { SearchService } from './search/search.service';
import { RoleFilterDto } from '../common/dto/search.dto';
import {
  CreateRoleDto,
  RoleDto,
  RunSearchDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { ClerkAuthContext } from '../auth/auth.types';
import { RequestException } from '../common/exception/core/ExceptionBase';
import { Serialize } from '../common/interceptors/serialize.interceptor';

@ApiTags('Roles')
@ApiBearerAuth('bearer')
@UseGuards(ClerkAuthGuard)
@Controller('roles')
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly searchService: SearchService,
  ) {}

  @Get()
  @Serialize(RoleDto)
  async findAll(
    @Query('projectId') projectId: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    if (!projectId) {
      throw new RequestException(
        'projectId query parameter is required',
        HttpStatus.BAD_REQUEST,
        'PROJECT_ID_REQUIRED',
      );
    }
    const orgId = this.requireOrgId(auth);
    return this.rolesService.findAllForProject(projectId, orgId, auth.userId);
  }

  @Get(':id')
  @Serialize(RoleDto)
  async findOne(
    @Param('id') id: string,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = this.requireOrgId(auth);
    return this.rolesService.findOne(id, orgId, auth.userId);
  }

  @Post()
  @Serialize(RoleDto)
  async create(
    @Body() body: CreateRoleDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = this.requireOrgId(auth);
    return this.rolesService.create(body, auth.userId, orgId);
  }

  @Patch(':id')
  @Serialize(RoleDto)
  async update(
    @Param('id') id: string,
    @Body() body: UpdateRoleDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = this.requireOrgId(auth);
    return this.rolesService.update(id, body, auth.userId, orgId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentAuth() auth: ClerkAuthContext) {
    const orgId = this.requireOrgId(auth);
    await this.rolesService.remove(id, auth.userId, orgId);
    return { success: true };
  }

  @Post('/:roleId/filters')
  async createFilter(
    @Param('roleId') roleId: string,
    @Body() body: RoleFilterDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = this.requireOrgId(auth);
    return this.rolesService.createFilter(roleId, body, orgId, auth.userId);
  }

  @Post('/:roleId/search')
  async search(
    @Param('roleId') roleId: string,
    @Body() body: RunSearchDto,
    @CurrentAuth() auth: ClerkAuthContext,
  ) {
    const orgId = this.requireOrgId(auth);
    const role = await this.rolesService.getRole(roleId, orgId, auth.userId);
    return this.searchService.search(body.filterId, role);
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
